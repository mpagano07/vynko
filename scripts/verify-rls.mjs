/**
 * Verificacion de aislamiento RLS / Storage contra el proyecto Supabase de test.
 *
 * Usa el MISMO vector de ataque que un atacante real: la anon key publica +
 * un JWT de usuario legitimo. Si las policies de 034/035/are tight, cada
 * operacion entre tenants o de DML directo debe fallar.
 *
 *   node scripts/verify-rls.mjs
 *
 * Variables (de .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, E2E_USER_EMAIL, E2E_USER_PASSWORD
 *
 * El script crea fixturesown en un tenant "victima" que el usuario NO
 * pertenece, verifica el aislamiento y limpia todo al terminar.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const env = {};
  const raw = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[m[1]] = value;
  }
  return env;
}

const env = loadEnv();
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const USER_EMAIL = env.E2E_USER_EMAIL;
const USER_PASSWORD = env.E2E_USER_PASSWORD;

if (!URL_BASE || !ANON || !SERVICE || !USER_EMAIL || !USER_PASSWORD) {
  console.error('Faltan variables en .env.local (URL / ANON / SERVICE / E2E_USER_*)');
  process.exit(2);
}

const admin = createClient(URL_BASE, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now();
const VICTIM = {
  tenant: null,
  product: null,
  supplier: null,
  customer: null,
  document: null,
  notification: null,
  movement: null,
  stock: null,
  storageObject: null,
};
const created = { ownStorage: null };

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

async function blocked(label, promise) {
  const { data, error } = await promise;
  const denied = Boolean(error) || data === null;
  check(label, denied, denied ? undefined : `permitio la operacion (data=${JSON.stringify(data)})`);
  return denied;
}
async function section(title, fn) {
  console.log(`\n== ${title}`);
  try {
    await fn();
  } catch (e) {
    fail += 1;
    failures.push(`${title} (excepcion)`);
    console.log(`  FAIL ${title} lanzo: ${e.message}`);
  }
}

async function setup() {
  const slug = `rls-verify-victim-${stamp}`;
  const { data: tenant, error } = await admin
    .from('tenants')
    .insert({ name: 'RLS Verify Victim', slug })
    .select()
    .single();
  if (error) throw new Error(`no se pudo crear tenant victim: ${error.message}`);
  VICTIM.tenant = tenant.id;

  const { data: product, error: pErr } = await admin
    .from('products')
    .insert({ name: `RLS Verify Product ${stamp}`, price: 1, price_cents: 100, cost: 1, cost_cents: 100 })
    .select()
    .single();
  if (pErr) throw new Error(`no se pudo crear producto victima: ${pErr.message}`);
  VICTIM.product = product.id;

  const { data: stock, error: sErr } = await admin
    .from('product_stock')
    .insert({ product_id: product.id, tenant_id: tenant.id, stock: 5 })
    .select()
    .single();
  if (sErr) throw new Error(`no se pudo crear stock victima: ${sErr.message}`);
  VICTIM.stock = stock.id;

  const { data: supplier } = await admin
    .from('suppliers')
    .insert({ tenant_id: tenant.id, name: `RLS Verify Supplier ${stamp}` })
    .select()
    .single();
  VICTIM.supplier = supplier.id;

  const { data: customer } = await admin
    .from('customers')
    .insert({ tenant_id: tenant.id, name: `RLS Verify Customer ${stamp}` })
    .select()
    .single();
  VICTIM.customer = customer.id;

  const { data: movement } = await admin
    .from('stock_movements')
    .insert({
      tenant_id: tenant.id,
      product_id: product.id,
      quantity: 5,
      movement_type: 'inbound',
    })
    .select()
    .single();
  VICTIM.movement = movement?.id ?? null;

  const { data: document } = await admin
    .from('commercial_documents')
    .insert({
      tenant_id: tenant.id,
      document_type: 'remito_salida',
      document_number: 9000 + (stamp % 900),
      customer_id: customer.id,
      customer_name: `RLS Verify Customer ${stamp}`,
      created_by: VICTIM_USER_ID,
    })
    .select()
    .single();
  VICTIM.document = document.id;

  const { data: notification } = await admin
    .from('notifications')
    .insert({
      tenant_id: tenant.id,
      type: 'system',
      title: 'RLS verify',
      message: 'fixture',
    })
    .select()
    .single();
  VICTIM.notification = notification.id;
}

let VICTIM_USER_ID = null;

async function loginAsUser() {
  const anonClient = createClient(URL_BASE, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anonClient.auth.signInWithPassword({
    email: USER_EMAIL,
    password: USER_PASSWORD,
  });
  if (error) throw new Error(`login E2E fallido: ${error.message}`);
  VICTIM_USER_ID = data.user.id;

  // Cliente con la anon key + JWT del usuario: exactamente lo que tiene un
  // navegador. Las policies de RLS son lo unico que protege aca.
  return createClient(URL_BASE, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

async function ownTenantIds(userId) {
  const { data } = await admin.from('tenant_users').select('tenant_id').eq('user_id', userId);
  return (data ?? []).map((t) => t.tenant_id);
}

async function teardown() {
  if (created.ownStorage) {
    await admin.storage.from('product-images').remove([created.ownStorage]);
  }
  if (VICTIM.storageObject) {
    await admin.storage.from('product-images').remove([VICTIM.storageObject]);
  }
  if (VICTIM.notification) await admin.from('notifications').delete().eq('id', VICTIM.notification);
  if (VICTIM.document) await admin.from('commercial_documents').delete().eq('id', VICTIM.document);
  if (VICTIM.movement) await admin.from('stock_movements').delete().eq('id', VICTIM.movement);
  if (VICTIM.customer) await admin.from('customers').delete().eq('id', VICTIM.customer);
  if (VICTIM.supplier) await admin.from('suppliers').delete().eq('id', VICTIM.supplier);
  if (VICTIM.stock) await admin.from('product_stock').delete().eq('id', VICTIM.stock);
  else if (VICTIM.product) {
    await admin.from('product_stock').delete().eq('product_id', VICTIM.product);
  }
  if (VICTIM.product) await admin.from('products').delete().eq('id', VICTIM.product);
  if (VICTIM.tenant) {
    await admin.from('products').delete().eq('name', `RLS Verify Product ${stamp}`);
    await admin.from('tenants').delete().eq('id', VICTIM.tenant);
  }
}

// ---------------------------------------------------------------------------

const user = await loginAsUser();
const ownTenants = await ownTenantIds(VICTIM_USER_ID);
console.log(`usuario: ${USER_EMAIL}`);
console.log(`tenants propios: ${ownTenants.length}, tenant victima: ${VICTIM.tenant ?? '(creandose)'}`);

await setup();
console.log(`fixture victima creada en ${VICTIM.tenant}`);

await section('service_role sigue operando (la app no se rompio)', async () => {
  const { data, error } = await admin.from('products').select('id').limit(1);
  check('service_role lee products', !error && Array.isArray(data), error?.message);
  const { error: e2 } = await admin.from('suppliers').select('id').limit(1);
  check('service_role lee suppliers', !e2, e2?.message);
});

await section('Aislamiento de lectura entre tenants', async () => {
  const { data: products } = await user.from('products').select('id, name');
  const ids = (products ?? []).map((p) => p.id);
  check(
    'products NO expone el producto del tenant victima',
    !ids.includes(VICTIM.product),
    `producto victima visible: ${ids.includes(VICTIM.product)}`
  );

  const { data: suppliers } = await user.from('suppliers').select('id, tenant_id');
  const sIds = (suppliers ?? []).map((s) => s.id);
  check('suppliers NO expone el supplier victima', !sIds.includes(VICTIM.supplier));
  check(
    'suppliers: toda fila pertenece a un tenant propio',
    (suppliers ?? []).every((s) => ownTenants.includes(s.tenant_id)),
    `filtrado: ${JSON.stringify((suppliers ?? []).filter((s) => !ownTenants.includes(s.tenant_id)).map((s) => s.id))}`
  );

  const { data: customers } = await user.from('customers').select('id, tenant_id');
  const cIds = (customers ?? []).map((c) => c.id);
  check('customers NO expone el customer victima', !cIds.includes(VICTIM.customer));
  check(
    'customers: toda fila pertenece a un tenant propio',
    (customers ?? []).every((c) => ownTenants.includes(c.tenant_id)),
    `filtrado: ${JSON.stringify((customers ?? []).filter((c) => !ownTenants.includes(c.tenant_id)).map((c) => c.id))}`
  );

  const { data: movements } = await user.from('stock_movements').select('id, tenant_id');
  const mIds = (movements ?? []).map((m) => m.id);
  check('stock_movements NO expone el movimiento victima', !mIds.includes(VICTIM.movement));
  check(
    'stock_movements: toda fila pertenece a un tenant propio',
    (movements ?? []).every((m) => ownTenants.includes(m.tenant_id)),
    `filtrado: ${JSON.stringify((movements ?? []).filter((m) => !ownTenants.includes(m.tenant_id)).map((m) => m.id))}`
  );

  const { data: docs } = await user.from('commercial_documents').select('id, tenant_id');
  const dIds = (docs ?? []).map((d) => d.id);
  check('commercial_documents NO expone el documento victima', !dIds.includes(VICTIM.document));
  check(
    'commercial_documents: toda fila pertenece a un tenant propio',
    (docs ?? []).every((d) => ownTenants.includes(d.tenant_id)),
    `filtrado: ${JSON.stringify((docs ?? []).filter((d) => !ownTenants.includes(d.tenant_id)).map((d) => d.id))}`
  );

  const { data: tenantRows } = await user.from('tenants').select('id');
  const tIds = (tenantRows ?? []).map((t) => t.id);
  check('tenants: solo ve sus propios tenants', tIds.every((id) => ownTenants.includes(id)),
    `filtrado: ${JSON.stringify(tIds.filter((id) => !ownTenants.includes(id)))}`);

  const { data: memberships } = await user.from('tenant_users').select('tenant_id, user_id');
  check(
    'tenant_users: solo ve sus propias membresias',
    (memberships ?? []).every((m) => m.user_id === VICTIM_USER_ID),
    `filtrado: ${JSON.stringify((memberships ?? []).filter((m) => m.user_id !== VICTIM_USER_ID))}`
  );

  const { data: stock } = await user.from('product_stock').select('product_id, tenant_id');
  check(
    'product_stock: solo ve su propio tenant',
    (stock ?? []).every((s) => ownTenants.includes(s.tenant_id)),
    `filtrado: ${JSON.stringify((stock ?? []).filter((s) => !ownTenants.includes(s.tenant_id)))}`
  );
});

await section('DML directo con anon key + JWT esta bloqueado', async () => {
  await blocked(
    'INSERT products directo',
    user
      .from('products')
      .insert({ name: `hacked-${stamp}`, price: 1, price_cents: 1, cost: 1, cost_cents: 1 })
      .select()
  );
  await blocked(
    'UPDATE products directo',
    user.from('products').update({ price: 0 }).eq('id', VICTIM.product).select()
  );
  await blocked(
    'DELETE products directo',
    user.from('products').delete().eq('id', VICTIM.product).select()
  );
  await blocked(
    'INSERT product_stock en tenant ajeno',
    user
      .from('product_stock')
      .insert({ product_id: VICTIM.product, tenant_id: VICTIM.tenant, stock: 9999 })
      .select()
  );
  await blocked(
    'UPDATE product_stock en tenant ajeno',
    user
      .from('product_stock')
      .update({ stock: 9999 })
      .eq('product_id', VICTIM.product)
      .eq('tenant_id', VICTIM.tenant)
      .select()
  );
  await blocked(
    'INSERT suppliers directo',
    user.from('suppliers').insert({ tenant_id: ownTenants[0], name: `hacked-${stamp}` }).select()
  );
  await blocked(
    'INSERT commercial_documents directo',
    user
      .from('commercial_documents')
      .insert({
        tenant_id: ownTenants[0],
        document_type: 'presupuesto',
        document_number: 9100 + (stamp % 80),
        customer_name: 'hacked',
        total_cents: 1,
        created_by: VICTIM_USER_ID,
      })
      .select()
  );
  await blocked(
    'INSERT notifications directo',
    user
      .from('notifications')
      .insert({
        tenant_id: ownTenants[0],
        type: 'system',
        title: 'hacked',
        message: 'hacked',
      })
      .select()
  );
  await blocked(
    'INSERT analytics_events directo',
    user
      .from('analytics_events')
      .insert({ event_type: 'signup', user_email: 'attacker@evil.test' })
      .select()
  );
  await blocked(
    'INSERT invitations directo',
    user
      .from('invitations')
      .insert({ tenant_id: ownTenants[0], email: 'attacker@evil.test', role: 'owner' })
      .select()
  );
  await blocked(
    'INSERT activity_logs directo',
    user.from('activity_logs').insert({ action: 'hacked', entity_type: 'product' }).select()
  );
});

await section('profiles.tenant_id es inmutable para el cliente', async () => {
  const { data: ownProfile } = await admin
    .from('profiles')
    .select('id, tenant_id')
    .eq('id', VICTIM_USER_ID)
    .single();
  check('el perfil propio tiene tenant_id', Boolean(ownProfile?.tenant_id));

  await blocked(
    'UPDATE profiles.tenant_id -> tenant victima',
    user.from('profiles').update({ tenant_id: VICTIM.tenant }).eq('id', VICTIM_USER_ID).select()
  );
  await blocked(
    'UPDATE profiles.tenant_id -> NULL',
    user.from('profiles').update({ tenant_id: null }).eq('id', VICTIM_USER_ID).select()
  );
  await blocked(
    'UPDATE profiles de OTRO usuario',
    user.from('profiles').update({ full_name: 'hacked' }).neq('id', VICTIM_USER_ID).select()
  );

  const { data: after } = await admin
    .from('profiles')
    .select('tenant_id')
    .eq('id', VICTIM_USER_ID)
    .single();
  check(
    'profiles.tenant_id quedo intacto',
    after?.tenant_id === ownProfile?.tenant_id,
    `antes=${ownProfile?.tenant_id} despues=${after?.tenant_id}`
  );
});

await section('Views de agregacion no accesibles para authenticated', async () => {
  for (const view of [
    'sales_daily_totals',
    'sales_monthly_totals',
    'tenant_first_activity',
    'analytics_events_by_month',
  ]) {
    const { data, error } = await user.from(view).select('*').limit(1);
    check(
      `view ${view} no devuelve datos al usuario`,
      Boolean(error) || (data ?? []).length === 0,
      error ? undefined : `devolvio ${(data ?? []).length} filas`
    );
  }
});

await section('Storage: bucket privado + prefijo por tenant', async () => {
  const { data: buckets } = await admin.storage.listBuckets();
  const bucket = (buckets ?? []).find((b) => b.id === 'product-images');
  check('el bucket product-images existe', Boolean(bucket));
  check('el bucket product-images es privado', bucket?.public === false, `public=${bucket?.public}`);

  // Upload desde el navegador al prefix de otro tenant: debe fallar.
  const victimPath = `${VICTIM.tenant}/rls-verify-${stamp}.png`;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const { error: upErr } = await user.storage
    .from('product-images')
    .upload(victimPath, png, { contentType: 'image/png', upsert: false });
  check('NO puede subir al prefix de otro tenant', Boolean(upErr), upErr?.message);

  // Upload al prefix propio: debe funcionar (la app lo necesita).
  const ownTenant = ownTenants[0];
  const ownPath = `${ownTenant}/rls-verify-${stamp}.png`;
  const { error: ownErr } = await user.storage
    .from('product-images')
    .upload(ownPath, png, { contentType: 'image/png', upsert: false });
  if (ownErr) {
    check('SI puede subir a su propio prefix', false, ownErr.message);
  } else {
    created.ownStorage = ownPath;
    check('SI puede subir a su propio prefix', true);

    const { data: list, error: listErr } = await user.storage
      .from('product-images')
      .list(VICTIM.tenant, { limit: 10 });
    check(
      'NO puede listar objetos de otro tenant',
      Boolean(listErr) || (list ?? []).length === 0,
      listErr?.message ?? `listo ${(list ?? []).length} objetos ajenos`
    );

    // getPublicUrl solo arma una URL: hay que pedirla de verdad para saber si
    // el bucket privado la sirve o no.
    const { data: pub } = await user.storage.from('product-images').getPublicUrl(ownPath);
    if (!pub?.publicUrl) {
      check('getPublicUrl no sirve el objeto (bucket privado)', true);
    } else {
      const res = await fetch(pub.publicUrl);
      const body = res.ok ? await res.text() : '';
      const leaked = res.ok && body.startsWith('\u0089PNG');
      check(
        'la URL "publica" NO entrega la imagen (bucket privado)',
        !leaked,
        `HTTP ${res.status} len=${body.length}`
      );
    }
  }
});

await section('Trigger de inmutabilidad de profiles (backstop a nivel motor)', async () => {
  // El service_role SI puede mover el tenant_id (onboarding/accept-invite).
  const { data: profile } = await admin
    .from('profiles')
    .select('tenant_id')
    .eq('id', VICTIM_USER_ID)
    .single();
  if (!profile?.tenant_id) {
    check('el trigger permite el cambio de tenant_id via service_role', false, 'perfil sin tenant');
    return;
  }
  const { error } = await admin
    .from('profiles')
    .update({ tenant_id: ownTenants[0] })
    .eq('id', VICTIM_USER_ID);
  check('service_role puede cambiar tenant_id (onboarding)', !error, error?.message);
});

await section('rate_limit_buckets es inaccesible desde el cliente', async () => {
  // Las claves de los buckets son IP y email: no pueden quedar expuestas al
  // cliente. Las funciones son SECURITY INVOKER con una guarda `current_user`
  // que solo deja pasar a service_role, y el permiso EXECUTE quedo revocado
  // para anon, authenticated y PUBLIC.
  const anon = createClient(URL_BASE, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Clave unica por corrida: si quedara una fila de una corrida anterior, el
  // primer intento ya vendria con el contador en 1 y el check de "permite el
  // primer intento" fallaria por un motivo que no tiene que ver con la migracion.
  const probeKey = `verify-rls:${stamp}`;

  //
  // OJO: aca NO se usa `blocked()` para la lectura, y con RLS no fallaria igual.
  // Un SELECT con RLS y sin policies devuelve 200 con `[]` (RLS filtra filas),
  // pero como la tabla ademas tiene REVOKE de PUBLIC, lo que llega es un error de
  // permiso, que es un resultado mas fuerte todavia. Se aceptan los dos y lo que
  // no se acepta es obtener una sola fila.
  const noRows = (label, r) =>
    check(
      label,
      (Boolean(r.error) || (Array.isArray(r.data) && r.data.length === 0)) &&
        !(Array.isArray(r.data) && r.data.length > 0),
      r.error ? `error=${r.error.message}` : `leyo ${r.data.length} filas`
    );

  noRows('anon NO lee filas de rate_limit_buckets', await anon.from('rate_limit_buckets').select('*'));
  noRows('authenticated NO lee filas de rate_limit_buckets', await user.from('rate_limit_buckets').select('*'));

  // `blocked()` por si solo no alcanza: un objeto inexistente tambien "falla" y
  // pasaria el check en verde sin que haya nada que proteger. Se exige que el
  // error sea de permiso (42501) y no de "no existe".
  async function denied(label, promise) {
    const { error } = await promise;
    const deniedCode = Boolean(error) && error.code === '42501';
    const missing =
      !error ||
      /does not exist|schema cache|Could not find/i.test(error.message ?? '');
    check(
      label,
      deniedCode,
      missing
        ? `no denego por permiso, sino porque falta el objeto: ${error?.message ?? 'sin error'}`
        : error?.message
    );
  }

  await denied(
    'anon NO puede escribir rate_limit_buckets',
    anon
      .from('rate_limit_buckets')
      .insert({ key: probeKey, count: 1, reset_at: new Date().toISOString() })
      .select()
  );

  // Estas dos son el ataque real, asi que se cubren para anon y para
  // authenticated. La anon key va en el bundle del navegador: con la sola
  // `NEXT_PUBLIC_SUPABASE_ANON_KEY` un atacante puede llamar la funcion por
  // PostgREST, agotarle el limite a una victima y dejarla sin poder entrar, o
  // inflar la tabla con claves inventadas de ventana larga.
  for (const [who, client] of [
    ['anon', anon],
    ['authenticated', user],
  ]) {
    await denied(
      `${who} NO puede ejecutar rate_limit_hit`,
      client.rpc('rate_limit_hit', { p_key: probeKey, p_limit: 1, p_window_ms: 60000 })
    );
    await denied(`${who} NO puede ejecutar rate_limit_reset_if_expired`, client.rpc('rate_limit_reset_if_expired'));
  }

  // Y el service_role si tiene que poder, que es lo que usa la app.
  const row = async () => {
    const { data, error } = await admin.rpc('rate_limit_hit', {
      p_key: probeKey,
      p_limit: 1,
      p_window_ms: 60000,
    });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) ?? {};
  };

  // La ventana fija tiene que contar y cortar, no solo no fallar.
  const first = await row();
  const second = await row();
  check('rate_limit_hit permite el primer intento', first.ok === true, JSON.stringify(first));
  check('rate_limit_hit bloquea al superar el limite', second.ok === false, JSON.stringify(second));
  check(
    'rate_limit_hit informa cuanto esperar',
    Number(second.retry_after_seconds) > 0,
    JSON.stringify(second)
  );

  // La purga tambien la tiene que poder ejecutar el service role: es la que
  // limpia las claves vencidas, y si la guarda la bloqueara las claves
  // crecerian para siempre.
  const purge = await admin.rpc('rate_limit_reset_if_expired');
  check('service_role puede purgar claves vencidas', !purge.error, purge.error?.message);

  // Y con la ventana abierta, el service role tiene que poder escribir en la
  // tabla. Las funciones corren con SECURITY INVOKER, o sea que el INSERT lo
  // hace el service role y no el dueno: si el REVOKE se hubiera pasado de la
  // raya y le hubiera quitado permisos a la app, aqui se veria.
  const { error: insertErr } = await admin.from('rate_limit_buckets').insert({
    key: `${probeKey}:escritura`,
    count: 1,
    reset_at: new Date(Date.now() + 60_000).toISOString(),
  });
  check('service_role puede escribir en la tabla', !insertErr, insertErr?.message);

  await admin.from('rate_limit_buckets').delete().in('key', [probeKey, `${probeKey}:escritura`]);
});

await teardown();

console.log(`\n${'='.repeat(60)}`);
console.log(`resultado: ${pass} ok, ${fail} fail`);
if (fail > 0) {
  console.log('fallos:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail > 0 ? 1 : 0);
