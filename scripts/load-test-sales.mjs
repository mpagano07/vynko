/**
 * Prueba de carga de POST /api/sales.
 *
 * Crea ventas REALES en la base de .env.local y, al terminar, borra las ventas
 * que genero y devuelve el stock del producto usado. No lo corras contra
 * produccion.
 *
 * Requiere `next dev`/`next start` en API_URL y .env.local con
 * E2E_USER_EMAIL / E2E_USER_PASSWORD (y SUPABASE_SERVICE_ROLE_KEY para el
 * cleanup).
 *
 *   node scripts/load-test-sales.mjs
 *   CONNECTIONS=100 DURATION=30 QUANTITY=1 node scripts/load-test-sales.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import autocannon from 'autocannon';
import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';
import dotenv from 'dotenv';

const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(__dirname, '.env.local'), quiet: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.E2E_USER_EMAIL;
const PASSWORD = process.env.E2E_USER_PASSWORD;

const API_URL = process.env.LOAD_TEST_API_URL ?? 'http://localhost:3000';
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 50);
const DURATION = Number(process.env.DURATION ?? 10);
const QUANTITY = Number(process.env.QUANTITY ?? 1);

// Cantidad de requests en vuelo por conexion. En 1 (default) autocannon espera
// la respuesta antes de mandar la siguiente, que es el modelo de una persona
// cobrando. Subirlo mide pipelining, no uso interactivo.
const PIPELINING = Number(process.env.PIPELINING ?? 1);

// Un p99 necesita varios cientos de muestras para significar algo. Con menos,
// el p99 es basicamente el maximo: asi se explica que en la primera version de
// este script salieran P99 == Max y pareciera un hallazgo.
const MIN_SAMPLES_FOR_P99 = 200;

/**
 * Autentica igual que el navegador: la app lee la sesion de las cookies de
 * Supabase SSR, asi que este script produce la cookie de sesion REAL en vez de
 * pedirle a la API que acepte un token por header.
 *
 * La primera version metio un atajo `Authorization: Bearer` en `getAuth()`
 * (src/lib/api-auth.ts) para poder hablar con la API. Quedo revertido: hacer que
 * la API acepte tokens por header es un cambio de superficie de
 * autenticacion en el camino critico, sin tests, solo para correr un benchmark.
 *
 * `createBrowserClient` serializa la sesion con el mismo nombre de cookie,
 * encoding base64url y chunking que usa `createServerClient`, asi que no hay
 * que hardcodear nada de eso. La sesion de E2E sale en dos chunks, `.0` y `.1`.
 */
async function login() {
  const jar = new Map();
  const supabase = createBrowserClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (items) => {
        for (const { name, value } of items) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) throw new Error(`Login fallo: ${error.message}`);
  if (jar.size === 0) throw new Error('El login no dejo cookie de sesion; el formato de @supabase/ssr cambio');

  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function apiGet(pathname, cookie) {
  const res = await fetch(`${API_URL}${pathname}`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Elige un producto con stock y se asegura de que haya para toda la corrida.
 *
 * La primera version tomaba `products[0]` sin mirar su stock y disparaba las 50
 * conexiones contra ese producto. Como el stock es finito, casi todo lo que
 * llegaba era 400 "Stock insuficiente": el benchmark terminaba midiendo
 * agotamiento de stock en vez de throughput, y los 400 se atribuyeron a
 * latencia.
 *
 * Corregir eso con un chequeo previo no alcanza. `unitsNeeded` se calculaba como
 * `CONNECTIONS * QUANTITY`, o sea UNA venta por conexion, cuando en realidad
 * `runLoad` lasts DURATION segundos: cada conexion envia decenas de ventas. Con
 * 50 conexiones y 15s se consumieron 301 unidades con un stock verificado de 72,
 * y el chequeo daba verde. Peor todavia: cuando el stock se agota a mitad de la
 * corrida, las Primeras requests miden throughput real y las ultimas miden 400, y
 * el percentil 50 sale de una mezcla de las dos.
 *
 * Por eso el stock se RESERVA de forma explicita antes de medir y se restituye
 * al valor original en el cleanup. Es determinista: la corrida no depende de
 * adivinar cuanto se va a vender.
 */
const STOCK_RESERVE = Number(process.env.STOCK_RESERVE ?? 5000);

async function pickProduct(cookie, unitsNeeded, tenantId) {
  const products = await apiGet('/api/products', cookie);
  const candidates = products
    .filter((p) => (p.stock ?? 0) >= unitsNeeded)
    .sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0));

  if (candidates.length === 0) {
    const max = products.reduce((m, p) => Math.max(m, p.stock ?? 0), 0);
    throw new Error(
      `Ningun producto tiene stock para ${unitsNeeded} unidades (el mayor stock es ${max}).\n` +
        'El test mide concurrencia sobre UN producto: sin stock suficiente las ventas\n' +
        'fallan por validacion de stock y el resultado no dice nada sobre performance.\n' +
        'Carga stock al producto mas grande, o baja CONNECTIONS/QUANTITY.'
    );
  }

  const product = candidates[0];
  const stockBefore = product.stock ?? 0;
  const reserved = Math.max(stockBefore, STOCK_RESERVE);

  if (reserved !== stockBefore) {
    // Service role, no la sesion del navegador: la reserva es una escritura
    // de infraestructura del test, no una accion del cajero.
    const { error } = await adminClient()
      .from('product_stock')
      .update({ stock: reserved })
      .eq('tenant_id', tenantId)
      .eq('product_id', product.id);

    if (error) {
      throw new Error(
        `No se pudo reservar stock para el producto "${product.name}": ${error.message}\n` +
          'Sin reserva explicita el stock se agota a mitad de la corrida y el\n' +
          'benchmark mide agotamiento de stock en vez de performance.'
      );
    }
    console.log(
      `Stock reservado: ${stockBefore} -> ${reserved} (se restituye en el cleanup)`
    );
  }

  return { product, stockBefore, reserved };
}

function countOk(result) {
  return result.requests.total - result.non2xx - result.errors - result.timeouts;
}

function runLoad({ cookie, payload, duration, connections }) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url: `${API_URL}/api/sales`,
      connections,
      duration,
      pipelining: PIPELINING,
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        // `isSameOriginRequest` (src/lib/security/csrf.ts) permite requests sin
        // header Origin: son clientes no-navegador y no son CSRF-vulnerable.
        // Enviarlo igual evita depender de esa excepcion.
        Origin: API_URL,
      },
      body: JSON.stringify(payload),
    });

    autocannon.track(instance, { renderProgressBar: true, renderResultsTable: false });
    instance.on('error', reject);
    instance.on('done', resolve);
  });
}

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

/**
 * IDs de todas las ventas del tenant, para poder distinguir las que creo este
 * test de las que ya estaban.
 */
async function snapshotSaleIds(tenantId) {
  const admin = adminClient();
  const ids = new Set();
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await admin
      .from('sales')
      .select('id')
      .eq('tenant_id', tenantId)
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`No se pudo leer el historial de ventas: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) ids.add(row.id);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return ids;
}

/**
 * Borra las ventas creadas por el test y restituye el stock del producto.
 *
 * Sin esto cada corrida deja el stock agotado para siempre y la siguiente falla
 * por 400, o sea: mide agotamiento de stock y se reporta como problema de
 * performance.
 *
 * Los borrados van en lotes y el stock se restituye SIEMPRE, incluso si borrar
 * las ventas falla. La version anterior hacia `.in('id', ids)` con las 680
 * ventas de una corrida de 15s: eso desborda la URL, PostgREST responde 400 y el
 * `throw` impedia restituir el stock. Peor todavia, los hijos ya estaban
 * borrados para esas 680 ventas, asi que quedaron 736 ventas huerfanas sin items
 * ni pagos, con el stock del producto inflado a 4264. El benchmark reportaba
 * "100% de exito" sobre datos que no se podian ni leer.
 */
async function cleanup({ product, tenantId, stockBefore, saleIds }) {
  const admin = adminClient();
  const CHUNK = 50;
  const failed = [];

  for (let i = 0; i < saleIds.length; i += CHUNK) {
    const batch = saleIds.slice(i, i + CHUNK);

    const pay = await admin.from('sale_payments').delete().in('sale_id', batch);
    if (pay.error) {
      failed.push(`sale_payments de ${batch.length} ventas: ${pay.error.message}`);
      continue;
    }

    const it = await admin.from('sale_items').delete().in('sale_id', batch);
    if (it.error) {
      failed.push(`sale_items de ${batch.length} ventas: ${it.error.message}`);
      continue;
    }

    // `create_sale_atomic` arma el motivo como 'Venta #' || substr(id, 1, 8).
    // Es una referencia dentro de un string, no una FK, asi que borrar la venta
    // no borra su movimiento de stock: quedan apuntando a algo que ya no existe
    // y ensucian el historial del producto. Se calculan los motivos aca porque
    // son derivables del id, y se borran en el mismo lote.
    const reasons = batch.map((id) => `Venta #${id.slice(0, 8)}`);
    const hist = await admin.from('stock_history').delete().in('reason', reasons);
    if (hist.error) failed.push(`stock_history de ${batch.length} ventas: ${hist.error.message}`);

    const s = await admin.from('sales').delete().in('id', batch).select('id');
    if (s.error) failed.push(`sales de ${batch.length} ventas: ${s.error.message}`);
  }

  // El stock se restituye aunque los borrados hayan fallado: dejarlo inflado
  // rompe la proxima corrida Y falsea cualquier lectura del producto.
  const { error: stockError } = await admin
    .from('product_stock')
    .update({ stock: stockBefore })
    .eq('product_id', product.id)
    .eq('tenant_id', tenantId);
  if (stockError) throw new Error(`No se pudo restituir el stock: ${stockError.message}`);

  console.log(
    `\nCleanup: ${saleIds.length - failed.length}/${saleIds.length} ventas borradas, ` +
      `stock de "${product.name}" restituido a ${stockBefore}.`
  );

  // Se verifica contra la base en vez de asumir: el fallo anterior fue
  // precisamente asumir que el `.in()` habia borrado todo.
  const { data: left } = await admin.from('sales').select('id').in('id', saleIds.slice(0, 200));
  const orphans = (left ?? []).filter((s) => saleIds.includes(s.id));
  if (orphans.length > 0 || failed.length > 0) {
    throw new Error(
      `Cleanup incompleto: ${orphans.length} ventas del test siguen en la base` +
        (failed.length > 0 ? ` (${failed.length} lotes con error: ${failed[0]})` : '') +
        '. Son huerfanas: sus items y pagos ya se borraron. Borrar manualmente ' +
        `antes de volver a correr el benchmark: ${orphans.slice(0, 5).map((s) => s.id).join(', ')}`
    );
  }
}

function report(result, { connections, duration, reserved, cleanupOk, saleCount, accepted }) {
  const { latency, requests, throughput, statusCodeStats, non2xx, errors, timeouts } = result;
  const ok = requests.total - non2xx - errors - timeouts;

  console.log('\n===== RESULTADOS =====');
  console.log(`Endpoint:          POST ${API_URL}/api/sales`);
  console.log(`Conexiones:        ${connections} (pipelining ${PIPELINING})`);
  console.log(`Duracion:          ${duration}s`);
  console.log(`Requests totales:  ${requests.total}`);
  console.log(`  2xx:             ${ok}`);
  console.log(`  non-2xx:         ${non2xx}`);
  console.log(`  errores de red:  ${errors}`);
  console.log(`  timeouts:        ${timeouts}`);
  // `requests.average` son requests por segundo. `throughput.average` son
  // BYTES por segundo: confundirlos da un numero ~1000x mayor que el real.
  console.log(`Requests/seg:      ${requests.average.toFixed(2)} req/s`);
  console.log(`Bytes/seg:         ${throughput.average.toFixed(0)} B/s`);

  console.log('\n----- Codigos de respuesta -----');
  const entries = Object.entries(statusCodeStats ?? {}).sort((a, b) => b[1].count - a[1].count);
  if (entries.length === 0) {
    console.log('(sin respuestas)');
  }
  for (const [code, { count }] of entries) {
    console.log(`  ${code}: ${count} (${((count / requests.total) * 100).toFixed(1)}%)`);
  }

  console.log('\n===== LATENCIA (ms) =====');
  console.log(`Muestras:          ${latency.totalCount}`);
  console.log(`Media:             ${latency.mean}`);
  console.log(`p50:               ${latency.p50}`);
  console.log(`p90:               ${latency.p90}`);
  console.log(`p97.5:             ${latency.p97_5}`);
  console.log(`p99:               ${latency.p99}`);
  console.log(`Max:               ${latency.max}`);

  console.log('\n===== VEREDICTO =====');
  const problems = [];

  if (non2xx > 0) {
    const breakdown = entries.map(([code, s]) => `${code}x${s.count}`).join(', ');
    problems.push(
      `${non2xx} respuestas non-2xx (${breakdown}). El stock estaba reservado ` +
        `a ${reserved} unidades, asi que un 400 no deberia ser "Stock insuficiente": ` +
        `si aparece igual, la reserva fallo y el resultado mide agotamiento de stock. ` +
        `El diagnostico de abajo muestra los mensajes reales del body.`
    );
  }
  if (latency.totalCount < MIN_SAMPLES_FOR_P99) {
    problems.push(
      `Solo ${latency.totalCount} muestras: el p99 de esa cantidad de requests es basicamente ` +
        `el maximo, asi que p99 == max es esperado y no es un hallazgo. Subi DURATION para ` +
        `llegar a ${MIN_SAMPLES_FOR_P99}+ muestras.`
    );
  }
  if (accepted > 0 && requests.average < 1) {
    problems.push(`Throughput de ${requests.average.toFixed(2)} req/s: no se completo ni una venta por segundo.`);
  }
  if (!cleanupOk) {
    problems.push('El cleanup no esta garantizado: el stock y las ventas quedaron modificados en la base.');
  }

  if (problems.length === 0) console.log('Sin observaciones.');
  for (const p of problems) console.log(`- ${p}`);

  // Informativo, no un problema: el cleanup borra por diferencia de IDs, no por
  // cantidad, asi que encuentra tambien las ventas de requests que quedaron en
  // vuelo cuando autocannon corto la medicion (el servidor las escribe igual).
  console.log(
    `Ventas creadas (calentamiento + medicion): ${accepted} confirmadas, ${saleCount} encontradas en la base.`
  );
}

/**
 * Dispara un burst de requests concurrentes y agrupa los errores por mensaje.
 *
 * Autocannon solo reporta el codigo HTTP, y un 400 a secas no dice si fue
 * validacion de negocio, conflicto de stock o un body vacio. Como estos errores
 * se solapan entre si (varias causas distintas pueden dar 400), el codigo no
 * alcanza para decidir nada: hay que leer el mensaje.
 */
async function diagnoseErrors({ cookie, payload, connections }) {
  const results = await Promise.all(
    Array.from({ length: connections }, async () => {
      try {
        const res = await fetch(`${API_URL}/api/sales`, {
          method: 'POST',
          headers: {
            Cookie: cookie,
            'Content-Type': 'application/json',
            Origin: API_URL,
          },
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        let message;
        try {
          message = JSON.parse(text).error ?? '(sin campo error)';
        } catch {
          message = `body no-JSON: "${text.slice(0, 80)}"`;
        }
        return `${res.status} ${message}`;
      } catch (err) {
        return `red ${err.message}`;
      }
    })
  );

  const tally = {};
  for (const line of results) tally[line] = (tally[line] ?? 0) + 1;

  console.log('\n----- Diagnostico: mensajes de error reales -----');
  Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .forEach(([line, count]) => console.log(`  ${count}x  ${line}`));
}

async function run() {
  const required = {
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    E2E_USER_EMAIL: EMAIL,
    E2E_USER_PASSWORD: PASSWORD,
  };
  for (const [name, value] of Object.entries(required)) {
    if (!value) throw new Error(`Falta ${name} en .env.local`);
  }

  const unitsNeeded = CONNECTIONS * QUANTITY;
  console.log(`API:    ${API_URL}`);
  console.log(`Carga:  ${CONNECTIONS} conexiones x ${DURATION}s = ${unitsNeeded} unidades\n`);

  const cookie = await login();
  const session = await apiGet('/api/session', cookie);
  const tenantId = session?.tenant?.id;
  if (!tenantId) throw new Error('No se pudo resolver el tenant del usuario E2E');

  // Antes de reservar stock. `pickProduct` ya ESCRIBE (reserva unidades para la
  // corrida), asi que sin service role no se puede ni revertir la reserva ni
  // limpiar las ventas: el producto queda con el stock inflado para siempre.
  if (!SERVICE_KEY) {
    throw new Error(
      'Falta SUPABASE_SERVICE_ROLE_KEY en .env.local. Sin service role el script no puede ' +
        'reservar stock ni limpiar: dejaria el stock modificado y las ventas metidas en la base.'
    );
  }

  const { product, stockBefore, reserved } = await pickProduct(cookie, unitsNeeded, tenantId);
  console.log(
    `Producto: "${product.name}" (${product.id}) con stock ${stockBefore}` +
      (reserved !== stockBefore ? ` (reservado a ${reserved})` : '')
  );

  const unitCents = product.price_cents ?? Math.round(Number(product.price) * 100);
  const payload = {
    payment_method: 'cash',
    items: [{ product_id: product.id, quantity: QUANTITY }],
    // Cada request es una venta independiente, asi que el pago cubre UNA venta.
    // Antes se mandaba el total de todas las conexiones, lo que generaba vuelto
    // en cada venta y ensuciaba `change_cents` con valores que no corresponden
    // a nada real.
    amount_paid: (unitCents * QUANTITY) / 100,
    discount_percent: 0,
    surcharge_percent: 0,
  };

  const before = await snapshotSaleIds(tenantId);

  // Calentamiento: las primeras requests pagan compilacion de rutas y JIT. Sin
  // esto la "latencia media" mezcla el arranque con la carga sostenida.
  console.log('\nCalentando (5s, no se mide)...');
  const warmup = await runLoad({ cookie, payload, duration: 5, connections: CONNECTIONS });

  console.log('\nMidiendo...');
  const result = await runLoad({ cookie, payload, duration: DURATION, connections: CONNECTIONS });
  const totalAccepted = countOk(warmup) + countOk(result);

  const after = await snapshotSaleIds(tenantId);
  const saleIds = [...after].filter((id) => !before.has(id));

  // Antes del cleanup: el diagnostico crea ventas y hay que borrarlas tambien.
  let diagnostic;
  try {
    diagnostic = await diagnoseErrors({ cookie, payload, connections: CONNECTIONS });
  } catch (err) {
    diagnostic = `\nNo se pudo correr el diagnostico de errores: ${err.message}`;
  }
  const saleIdsAfterDiag = [...(await snapshotSaleIds(tenantId))].filter(
    (id) => !before.has(id)
  );

  let cleanupOk = true;
  try {
    await cleanup({ product, tenantId, stockBefore, saleIds: saleIdsAfterDiag });
  } catch (err) {
    cleanupOk = false;
    console.error(`\nCleanup fallo: ${err.message}`);
  }

  report(result, {
    connections: CONNECTIONS,
    duration: DURATION,
    reserved,
    cleanupOk,
    saleCount: saleIds.length,
    accepted: totalAccepted,
  });

  console.log(diagnostic);
}

run().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
