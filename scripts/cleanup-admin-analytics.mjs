// Comando para correr (descomentar y cambiar el email):
// node scripts/cleanup-admin-analytics.mjs --email cuenta@ejemplo.com --env .env.prod.local --dry-run
// node scripts/cleanup-admin-analytics.mjs --email cuenta@ejemplo.com --env .env.prod.local --confirm
//
// Ejecutar con: node scripts/cleanup-admin-analytics.mjs [--email <email>] [--env <archivo>] [--dry-run] [--confirm]
//
// Borra de analytics_events los eventos de cuentas internas: por defecto todas
// las que tienen is_admin = TRUE, o un email puntual con --email (por ejemplo
// una cuenta de prueba que no es admin).
//
// Por que existe: la cuenta de admin tambien usa el producto (pruebas, ventas
// de demostracion, aperturas de caja), y esos eventos ensucian el embudo de
// /admin/analytics: el panel termina mostrando a "un cliente" que en realidad
// es el dueno del producto. Lo mismo pasa con cuentas de prueba. Este script
// limpia esos registros para que el embudo cuente solo clientes reales.
//
// Que borra:
//   - Filas con user_id del perfil admin (o del email indicado con --email).
//   - Filas viejas (anteriores a la migracion 040) que no tienen user_id pero
//     si user_email de esa cuenta.
//
// Que NO borra:
//   - Eventos de otros usuarios de un tenant del admin. El evento es de la
//     persona, no de la empresa; borrar por tenant_id se llevaria por delante
//     a empleados reales.
//   - Filas sin user_id y sin user_email: no se pueden atribuir a nadie, asi
//     que se informan pero se dejan intactas.
//   - Nada mas que analytics_events. No toca tenants, ventas, productos, caja
//     ni activity_logs.
//
// Uso:
//   node scripts/cleanup-admin-analytics.mjs --dry-run
//   node scripts/cleanup-admin-analytics.mjs --email prueba@ejemplo.com --dry-run
//   node scripts/cleanup-admin-analytics.mjs --env .env.prod.local --dry-run
//   node scripts/cleanup-admin-analytics.mjs --email prueba@ejemplo.com --env .env.prod.local --confirm
//
// --dry-run no escribe. Sin --dry-run hace falta --confirm, y el script
// imprime siempre el proyecto Supabase de destino antes de tocar nada.
//
// Requiere: SUPABASE_SERVICE_ROLE_KEY y NEXT_PUBLIC_SUPABASE_URL
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
// claves ya existirian: el script creeria estar en prod y borraria en dev.
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

const PROJECT_REF = (() => {
  try {
    return new URL(supabaseUrl).hostname.split('.')[0];
  } catch {
    return '???';
  }
})();

const emailIdx = process.argv.indexOf('--email');
if (
  emailIdx !== -1 &&
  (!process.argv[emailIdx + 1] || process.argv[emailIdx + 1].startsWith('--'))
) {
  console.error('--email necesita un email. Ejemplo: --email prueba@ejemplo.com');
  process.exit(1);
}
const emailArg = emailIdx !== -1 ? process.argv[emailIdx + 1] : null;
const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--confirm');

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Trae todas las filas de una consulta, sin el tope de 1000 de PostgREST. */
async function selectAll(buildQuery) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function findTargets() {
  // Sin --email: todas las cuentas admin.
  if (!emailArg) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, is_admin')
      .eq('is_admin', true);

    if (error) throw new Error(`profiles: ${error.message}`);

    const targets = (data ?? []).filter((p) => p.email);
    if (!targets.length) throw new Error('No hay perfiles con is_admin = TRUE');
    return targets;
  }

  // Con --email: cualquier cuenta, sea admin o no (por ejemplo una cuenta de
  // prueba). La busqueda por ilike es insensible a mayusculas, pero se compara
  // el email exacto en JS: si el valor trae "_" o "%", ilike los trata como
  // comodines y podria traer otras filas.
  const wanted = emailArg.trim();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, is_admin')
    .ilike('email', wanted);

  if (error) throw new Error(`profiles: ${error.message}`);

  const match = (data ?? []).find(
    (p) => p.email && p.email.toLowerCase() === wanted.toLowerCase()
  );

  if (match) return [match];

  // Sin perfil: la cuenta pudo haberse borrado, o el email solo quedo en filas
  // viejas de analytics_events. Se borra igual por user_email, con id nulo
  // para no intentar filtrar por user_id.
  console.log(
    `AVISO: no hay perfil con el email ${wanted}. Se borrara solo por user_email.`
  );
  return [{ id: null, email: wanted, full_name: null, is_admin: false }];
}

async function fetchMatchingEvents(targets) {
  const ids = targets.map((t) => t.id).filter((id) => id);
  const emails = [...new Set(targets.flatMap((t) => [t.email, t.email.toLowerCase()]))];

  const byUser = ids.length
    ? await selectAll(() =>
        supabase
          .from('analytics_events')
          .select('id, event_type, user_id, user_email')
          .in('user_id', ids)
      )
    : [];

  const byEmail = await selectAll(() =>
    supabase
      .from('analytics_events')
      .select('id, event_type, user_id, user_email')
      .in('user_email', emails)
  );

  const merged = new Map();
  for (const row of [...byUser, ...byEmail]) merged.set(row.id, row);
  return [...merged.values()];
}

async function countOrphans() {
  const { count, error } = await supabase
    .from('analytics_events')
    .select('id', { count: 'exact', head: true })
    .is('user_id', null)
    .is('user_email', null);
  if (error) throw new Error(`analytics_events: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const targets = await findTargets();

  console.log(`\nDestino: proyecto Supabase "${PROJECT_REF}"`);
  console.log(`  ${supabaseUrl}`);
  console.log(`Cuentas a limpiar: ${targets.length}`);
  for (const t of targets) {
    const idLabel = t.id ? t.id : 'sin perfil';
    console.log(`  - ${t.email} (${idLabel})${t.full_name ? ` — ${t.full_name}` : ''}`);
  }

  const events = await fetchMatchingEvents(targets);
  const byType = new Map();
  for (const e of events) byType.set(e.event_type, (byType.get(e.event_type) ?? 0) + 1);

  console.log(`\nEventos a borrar: ${events.length}`);
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(6)}  ${type}`);
  }

  const withoutUserId = events.filter((e) => !e.user_id).length;
  if (withoutUserId) {
    console.log(`  (${withoutUserId} son filas viejas sin user_id, matcheadas por email)`);
  }

  const orphans = await countOrphans();
  if (orphans) {
    console.log(
      `\nAviso: hay ${orphans} evento(s) sin user_id ni user_email. No se pueden atribuir ` +
        'a nadie y NO se borran.'
    );
  }

  if (!events.length) {
    console.log('\nNo hay nada que borrar. Listo.\n');
    return;
  }

  if (dryRun) {
    console.log('\n--dry-run: no se borro nada.\n');
    return;
  }

  if (!confirmed) {
    console.log(`Falta --confirm. Se borraria en el proyecto "${PROJECT_REF}".`);
    console.log('Nada fue borrado. Volve a correr con --confirm si el destino es el correcto.\n');
    return;
  }

  console.log('\nBorrando...');

  // 1. Por user_id: cubre las filas nuevas y tambien las viejas cuyo user_id
  //    ya fue completado por backfill-user-analytics.mjs. Si el email no tiene
  //    perfil, no hay id y este paso se saltea.
  const ids = targets.map((t) => t.id).filter((id) => id);
  let byUserId = 0;
  if (ids.length) {
    const { count, error } = await supabase
      .from('analytics_events')
      .delete({ count: 'exact' })
      .in('user_id', ids);
    if (error) throw new Error(`delete por user_id: ${error.message}`);
    byUserId = count ?? 0;
  }

  // 2. Por email: cubre las filas historicas que nunca tuvieron user_id.
  const emails = [...new Set(targets.flatMap((t) => [t.email, t.email.toLowerCase()]))];
  const { count: byEmailCount, error: emailError } = await supabase
    .from('analytics_events')
    .delete({ count: 'exact' })
    .in('user_email', emails);
  if (emailError) throw new Error(`delete por user_email: ${emailError.message}`);

  console.log(`  por user_id:    ${byUserId}`);
  console.log(`  por user_email: ${byEmailCount ?? 0}`);

  const remaining = await fetchMatchingEvents(targets);
  console.log(`\nRestantes: ${remaining.length}`);
  if (remaining.length) {
    console.error('  ERROR: quedaron filas sin borrar. Revisar permisos o RLS.');
    process.exit(1);
  }

  console.log('\nListo. Recargá /admin/analytics para ver el embudo limpio.\n');
}

main().catch((err) => {
  console.error(`\nError: ${err.message}\n`);
  process.exit(1);
});
