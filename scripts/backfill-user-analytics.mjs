// Ejecutar con: node scripts/backfill-user-analytics.mjs <email> [--dry-run]
//
// Rellena analytics_events para UNA persona a partir de la actividad que ya
// tiene registrada en el negocio, para que aparezca en el embudo de
// /admin/analytics.
//
// Por que existe: la instrumentacion de eventos arranca con la migracion 040.
// Los clientes que ya estaban usando el producto pasaron por todos los pasos
// (crearon empresa, cargaron productos, vendieron) sin que quedara ningun
// evento, asi que el embudo los muestra en 0. Este script reconstruye su
// recorrido con los timestamps REALES que ya tiene en la base.
//
// Que NO hace:
//   - No inventa eventos. `app_return`, `whatsapp_ticket` y
//     `forecast_opened` no dejaron nunca ningun rastro (el primero y el
//     ultimo no se instrumentaban, y el de WhatsApp es un window.open que no
//     consulta la base), asi que NO se generan. Los pasos del embudo que
//     dependen de ellos van a quedar en 0. Es preferible un 0 honesto a una
//     cifra inventada que se termina tomando como real.
//   - No toca el negocio. Escribe unicamente en analytics_events. No
//     modifica tenants, ventas, productos, caja ni documentos.
//   - No borra los eventos que ya existen. Solo les completa el user_id.
//
// Uso:
//   node scripts/backfill-user-analytics.mjs cliente@vynko.dev
//   node scripts/backfill-user-analytics.mjs cliente@vynko.dev --dry-run
//   node scripts/backfill-user-analytics.mjs cliente@vynko.dev --env .env.prod.local --dry-run
//   node scripts/backfill-user-analytics.mjs cliente@vynko.dev --env .env.prod.local --confirm
//
// --dry-run no escribe. Sin --dry-run hace falta --confirm, y el script
// imprime siempre el proyecto Supabase de destino antes de tocar nada.
//
// Requiere: SUPABASE_SERVICE_ROLE_KEY y NEXT_PUBLIC_SUPABASE_URL
// Y la migracion 040 aplicada (sin ella no existe la columna user_id y el
// CHECK de event_type rechaza los eventos nuevos).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Carga de variables de entorno ----------
//
// override = true pisa lo que ya estaba cargado. Sin esto, el archivo de
// prod se cargaria DESPUES de .env.local y no tendria efecto, porque las
// claves ya existirian: el script creeria estar en prod y escribiria en
// dev. Ese es exactamente el error que hay que evitar.
function loadEnv(file, override = false) {
  if (!fs.existsSync(file)) return false;
  const content = fs.readFileSync(file, 'utf8');
  for (const line of content.split('\n')) {
    const matched = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!matched) continue;
    const key = matched[1];
    let val = (matched[2] ?? '').trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (override || process.env[key] === undefined) process.env[key] = val;
  }
  return true;
}

// Primero .env.local, como base por defecto.
loadEnv(path.resolve(__dirname, '..', '.env.local'));

const { createClient } = require('@supabase/supabase-js');

// --env <archivo> elige de donde salen las credenciales. Por defecto
// .env.local (dev). Para prod: --env .env.prod.local
const envIdx = process.argv.indexOf('--env');
if (envIdx !== -1 && process.argv[envIdx + 1]) {
  const file = process.argv[envIdx + 1];
  if (loadEnv(path.resolve(__dirname, '..', file), true)) {
    console.log(`Credenciales leidas de ${file} (pisan a .env.local).`);
  } else {
    console.error(`No existe el archivo ${file}. Abortando.`);
    process.exit(1);
  }
} else {
  console.log('AVISO: sin --env se usan las credenciales de .env.local (dev).');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Faltan variables de entorno (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  process.exit(1);
}

// Ref del proyecto, para que quede a la vista a que base se esta escribiendo.
const PROJECT_REF = (() => {
  try {
    return new URL(supabaseUrl).hostname.split('.')[0];
  } catch {
    return '???';
  }
})();

const emailArg = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--confirm');
// Adelanta company_created/trial_started hasta la primera actividad real.
// Solo para bases donde tenants.created_at quedó desactualizado (tenants
// recreados al sincronizar). Queda marcado en el metadata de cada evento.
const clampCompanyCreated = process.argv.includes('--clamp-company-created');

if (!emailArg || emailArg.startsWith('--')) {
  console.error('Uso: node scripts/backfill-user-analytics.mjs <email> [--env <archivo>] [--dry-run] [--confirm] [--clamp-company-created]');
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Tenants donde la persona es owner. La suscripcion es del owner, asi que el
// journey se reconstruye sobre su(s) rama(s).
/**
 * La migracion 040 tiene que estar aplicada antes de tocar nada: sin la
 * columna user_id no se pueden completar las filas viejas, y el CHECK de
 * event_type rechaza los eventos nuevos. Se verifica al principio para fallar
 * con un mensaje que diga que hacer, en vez de con un error de Postgres a
 * mitad de camino.
 */
async function assertMigrationApplied() {
  const { error } = await supabase.from('analytics_events').select('user_id').limit(1);
  if (!error) return;

  if (/column .* user_id does not exist|column .*user_id.* does not exist/i.test(error.message)) {
    throw new Error(
      'La migracion 040_product_analytics_funnel.sql NO esta aplicada en esta base.\n' +
        '  Falta la columna analytics_events.user_id.\n' +
        '  Aplicala por el SQL Editor de Supabase y volve a correr el script.'
    );
  }

  throw new Error(`No se pudo leer analytics_events: ${error.message}`);
}

async function findUser() {
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, email, full_name, tenant_id')
    .eq('email', email)
    .maybeSingle();

  if (profileError) throw new Error(`profiles: ${profileError.message}`);
  if (!profiles) {
    throw new Error(`No hay ningun perfil con el email ${email}`);
  }

  const { data: memberships, error: memberError } = await supabase
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', profiles.id);

  if (memberError) throw new Error(`tenant_users: ${memberError.message}`);

  return { profile: profiles, memberships: memberships ?? [] };
}

/** Minimo created_at de una consulta, o null si no hay filas. */
async function earliest(table, columns, filters = {}) {
  let q = supabase.from(table).select(columns.join(',')).order('created_at', { ascending: true }).limit(1);
  for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);

  const { data, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return data?.[0] ?? null;
}

async function main() {
  await assertMigrationApplied();

  const { profile, memberships } = await findUser();
  const ownerTenantIds = memberships.filter((m) => m.role === 'owner').map((m) => m.tenant_id);
  const tenantIds = [...new Set(memberships.map((m) => m.tenant_id))];

  console.log(`\nDestino: proyecto Supabase "${PROJECT_REF}"`);
  console.log(`  ${supabaseUrl}`);
  console.log(`Usuario: ${profile.email} (${profile.id})`);
  console.log(`Nombre:  ${profile.full_name ?? '(sin nombre)'}`);
  console.log(`Tenants: ${tenantIds.length} (${ownerTenantIds.length} como owner)\n`);

  const tenants = [];
  for (const tid of tenantIds) {
    const { data } = await supabase
      .from('tenants')
      .select('id, name, created_at, subscription_status, subscription_plan')
      .eq('id', tid)
      .maybeSingle();
    if (data) tenants.push(data);
  }

  // ----- Eventos derivados de datos reales -----
  //
  // El embudo es POR PERSONA, no por sucursal: alguien que vende en cuatro
  // sucursales hizo su "primera venta" una sola vez, en la más antigua. Por
  // eso cada tipo de evento se reduce al minimo global entre todos los
  // tenants, guardando en qué sucursal ocurrió. Reducirlo por tenant
  // produciría cuatro "primera venta" y el índice único rechazaría tres.
  const derived = new Map();

  const keepEarliest = (eventType, at, tenantId, metadata) => {
    const prev = derived.get(eventType);
    if (prev && prev.at <= at) return;
    derived.set(eventType, { event_type: eventType, at, tenant_id: tenantId, metadata });
  };

  const firstTenant = [...tenants].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

  if (firstTenant) {
    keepEarliest('company_created', firstTenant.created_at, firstTenant.id, {
      plan: firstTenant.subscription_plan,
      backfilled: true,
      from: 'tenants.created_at',
    });
    // El trial arranca con la empresa: es el mismo instante, no se inventa
    // una fecha distinta.
    keepEarliest('trial_started', firstTenant.created_at, firstTenant.id, {
      plan: firstTenant.subscription_plan,
      backfilled: true,
      from: 'tenants.created_at',
    });
  }

  // activity_logs tiene el historial real de cada accion, con su timestamp.
  const logQueries = [
    { event_type: 'product_created', filters: { action: 'created', entity_type: 'product' } },
    { event_type: 'excel_import', filters: { action: 'imported', entity_type: 'import' } },
    { event_type: 'first_purchase', filters: { action: 'received', entity_type: 'purchase_order' } },
    { event_type: 'first_purchase', filters: { action: 'partial_receive', entity_type: 'purchase_order' } },
    { event_type: 'first_cash_open', filters: { action: 'Caja abierta', entity_type: 'cash_register_session' } },
  ];

  for (const q of logQueries) {
    for (const tid of tenantIds) {
      const row = await earliest('activity_logs', ['created_at', 'details', 'entity_id'], {
        user_id: profile.id,
        tenant_id: tid,
        ...q.filters,
      });
      if (!row) continue;
      keepEarliest(q.event_type, row.created_at, tid, {
        backfilled: true,
        from: `activity_logs.${q.filters.action}`,
        entityId: row.entity_id,
        ...(row.details ?? {}),
      });
    }
  }

  // Ventas completadas: el evento va contra la tabla, no contra activity_logs,
  // para no depender de que el log se haya escrito.
  for (const tid of tenantIds) {
    const sale = await earliest('sales', ['id', 'created_at', 'total_cents', 'status'], {
      tenant_id: tid,
      status: 'completed',
    });
    if (sale) {
      keepEarliest('first_sale', sale.created_at, tid, {
        backfilled: true,
        from: 'sales.completed',
        saleId: sale.id,
        totalCents: sale.total_cents,
      });
    }

    const doc = await earliest('commercial_documents', ['id', 'created_at', 'document_type'], {
      tenant_id: tid,
    });
    if (doc) {
      keepEarliest('document_created', doc.created_at, tid, {
        backfilled: true,
        from: 'commercial_documents',
        documentId: doc.id,
        documentType: doc.document_type,
      });
    }
  }

  // Suscripcion: NO se deriva del estado del tenant.
  //
  // `subscription_status = 'active'` dice que hoy esta activo, no cuando pago.
  // Poner la fecha de alta del tenant seria inventar un cobro que nadie
  // registro, y ademas es justamente el paso que cierra el embudo: una fecha
  // inventada ahi falsea la conversion final.
  //
  // Solo se usa el `payment` real que dejo el webhook. Si no existe, el
  // usuario llega hasta app_return y se detiene: que es la verdad.
  const { data: legacyPayments } = await supabase
    .from('analytics_events')
    .select('id, event_type, created_at, metadata, user_id')
    .eq('user_email', email)
    .in('event_type', ['payment', 'subscription_started']);

  for (const p of legacyPayments ?? []) {
    if (p.event_type === 'subscription_started') {
      keepEarliest('subscription_started', p.created_at, null, { backfilled: true, from: 'analytics_events' });
    }
  }

  // ----- Anomalía: actividad anterior a la creación del tenant -----
  //
  // Si hay movimiento antes de tenants.created_at, ese created_at no dice
  // cuándo se creó la empresa. Pasa cuando los tenants se recrearon (por
  // ejemplo al sincronizar una base a otra) y el negocio se copió con sus
  // timestamps originales: la empresa "nace" después de sus propias ventas.
  //
  // No se corrige en silencio. Si se escribiera igual, el embudo descartaría
  // por orden todos los pasos posteriores al de la empresa y mostraría que el
  // usuario no hizo nada, cuando en realidad es un artefacto de la carga.
  const businessEvents = [...derived.values()]
    .filter((d) => ['product_created', 'first_sale', 'document_created', 'first_purchase', 'first_cash_open'].includes(d.event_type))
    .sort((a, b) => a.at.localeCompare(b.at));
  const earliestBusiness = businessEvents[0] ?? null;
  const anomaly = Boolean(firstTenant && earliestBusiness && earliestBusiness.at < firstTenant.created_at);

  if (anomaly) {
    console.log('\n*** ANOMALIA ***');
    console.log(`  Hay actividad desde ${earliestBusiness.at.slice(0, 10)} pero tenants.created_at`);
    console.log(`  dice ${firstTenant.created_at.slice(0, 10)}. Los tenants parecen haberse recreado y`);
    console.log('  ese created_at no es la fecha real de alta.');
    console.log('  Con estos timestamps el embudo daria 1, 1, 0, 0, 0, 0 porque todos los pasos');
    console.log('  posteriores a la empresa quedan ANTERIORES a ella y se descartan por orden.');
    if (!clampCompanyCreated) {
      console.log('  No se escribe nada hasta que lo confirmes. Ver --clamp-company-created.\n');
    }
  }

  // El clamp se aplica ANTES de listar, para que el listado muestre las
  // fechas que realmente se van a escribir y no las originales.
  if (anomaly && clampCompanyCreated) {
    const floor = earliestBusiness.at;
    for (const key of ['company_created', 'trial_started']) {
      const ev = derived.get(key);
      if (ev) {
        ev.metadata = {
          ...ev.metadata,
          clamped: true,
          originalCreatedAt: ev.at,
          note: 'fecha adelantada a la primera actividad real',
        };
        ev.at = floor;
      }
    }
    console.log(`\n--clamp-company-created: company_created y trial_started adelantados a ${floor.slice(0, 10)}.\n`);
  }

  const derivedList = [...derived.values()].sort((a, b) => a.at.localeCompare(b.at));

  // ----- Que hay ya escrito -----
  const { data: existing, error: existingError } = await supabase
    .from('analytics_events')
    .select('id, event_type, created_at, user_id')
    .eq('user_email', email);

  if (existingError) throw new Error(`analytics_events: ${existingError.message}`);

  const existingWithUserId = (existing ?? []).filter((e) => e.user_id);
  const existingWithoutUserId = (existing ?? []).filter((e) => !e.user_id);
  const existingTypes = new Set((existing ?? []).map((e) => e.event_type));

  console.log(`Eventos ya registrados para este email: ${existing?.length ?? 0}`);
  console.log(`  con user_id:    ${existingWithUserId.length}`);
  console.log(`  sin user_id:    ${existingWithoutUserId.length}  <- invisibles para las vistas nuevas`);
  console.log(`\nEventos a derivar: ${derivedList.length}\n`);

  for (const d of derivedList) {
    const already = existingTypes.has(d.event_type);
    const mark = already ? 'YA EXISTE (se conserva)' : 'nuevo';
    console.log(`  ${d.at.slice(0, 10)}  ${d.event_type.padEnd(22)} ${mark}`);
  }

  const missing = ['app_return', 'whatsapp_ticket', 'forecast_opened'];
  console.log(`\nNO se generan (no dejaron rastro historico): ${missing.join(', ')}`);
  console.log('  Si el panel los muestra en 0 es correcto: no se sabe, no es que no los hizo.\n');

  if (anomaly && !clampCompanyCreated) {
    console.log('Abortado por la anomalía. Nada fue escrito.\n');
    printUndo(email, profile.id);
    return;
  }

  if (dryRun) {
    console.log('--dry-run: no se escribio nada.\n');
    printUndo(email, profile.id);
    return;
  }

  // Ultimo candado antes de escribir. Sin --confirm el script no toca nada,
  // aunque no se haya pedido --dry-run: asi un flag olvidado no alcanza para
  // modificar la base equivocada.
  if (!confirmed) {
    console.log(`Falta --confirm. Se escribiria en el proyecto "${PROJECT_REF}".`);
    console.log('Nada fue escrito. Volve a correr con --confirm si el destino es el correcto.\n');
    printUndo(email, profile.id);
    return;
  }

  // ----- 1. Completar user_id de las filas existentes -----
  // Esto es lo que hace que el usuario "ya figuraba" siga figurando: la fila
  // vieja no se toca ni se borra, solo se le completa la columna que las
  // vistas nuevas necesitan para poder leerla.
  if (existingWithoutUserId.length) {
    console.log(`Completando user_id en ${existingWithoutUserId.length} evento(s) existentes...`);
    const { error } = await supabase
      .from('analytics_events')
      .update({ user_id: profile.id })
      .in('id', existingWithoutUserId.map((e) => e.id));

    if (error) throw new Error(`update user_id: ${error.message}`);
    console.log('  ok');
  }

  // ----- 2. Insertar los derivados que falten -----
  const toInsert = derivedList.filter((d) => !existingTypes.has(d.event_type));
  if (toInsert.length) {
    console.log(`\nInsertando ${toInsert.length} evento(s) nuevo(s)...`);
    const rows = toInsert.map((d) => ({
      event_type: d.event_type,
      user_id: profile.id,
      user_email: profile.email,
      user_name: profile.full_name ?? null,
      tenant_id: d.tenant_id ?? null,
      metadata: d.metadata,
      created_at: d.at,
    }));

    const { error } = await supabase.from('analytics_events').insert(rows);
    if (error) {
      if (error.code === '23514') {
        console.error('\n  ERROR: el CHECK de event_type rechazo el insert.');
        console.error('  Falta aplicar la migracion 040_product_analytics_funnel.sql.\n');
      }
      throw new Error(`insert: ${error.message}`);
    }
    console.log('  ok');
  } else {
    console.log('\nNo habia eventos nuevos que insertar.');
  }

  console.log('\nListo. Recargá /admin/analytics para ver el embudo.\n');
  printUndo(email, profile.id);
}

function printUndo(email, userId) {
  console.log('--- Para revertir esto ---');
  console.log(`  DELETE FROM analytics_events WHERE user_id = '${userId}';`);
  console.log(`  DELETE FROM analytics_events WHERE user_email = '${email}';`);
  console.log('(La segunda borra tambien las filas viejas. Solo corré una.');
  console.log(' Ojo: si otros scripts dependen de esas filas, no las borres.)\n');
}

main().catch((err) => {
  console.error(`\nError: ${err.message}\n`);
  process.exit(1);
});
