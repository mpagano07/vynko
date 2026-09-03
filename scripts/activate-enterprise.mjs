// Executes with: node scripts/activate-enterprise.mjs <tenantSlugOrId>
//
// Activa manualmente el plan Enterprise para un tenant (backoffice/ventas).
// El plan Enterprise NO se cobra vía Mercado Pago recurrente: se cotiza de
// forma personalizada. Este script es el mecanismo de alta para los pocos
// clientes enterprise, sin pasar por preapproval.
//
// Uso:
//   node scripts/activate-enterprise.mjs <tenant-slug>
//   node scripts/activate-enterprise.mjs <tenant-uuid>
//   node scripts/activate-enterprise.mjs <tenant-slug> --days=365   (duración del ciclo)
//   node scripts/activate-enterprise.mjs <tenant-slug> --dry-run
//
// Requiere: SUPABASE_SERVICE_ROLE_KEY y NEXT_PUBLIC_SUPABASE_URL en .env.local
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Carga de variables de entorno ----------
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf8');
  for (const line of content.split('\n')) {
    const matched = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!matched) continue;
    const key = matched[1];
    let val = (matched[2] ?? '').trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv(path.resolve(__dirname, '..', '.env.local'));

// ---------- Dependencias ----------
const { createClient } = require('@supabase/supabase-js');

// ---------- Configuración ----------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Faltan variables de entorno. Revisa .env.local');
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const idArg = args.find((a) => !a.startsWith('--'));
const daysArg = args
  .find((a) => a.startsWith('--days='))
  ?.replace(/^--days=/, '');

const dryRun = process.argv.includes('--dry-run');
const cycleDays = daysArg !== undefined ? Number(daysArg) : 365;

if (!idArg) {
  console.error('Uso: node scripts/activate-enterprise.mjs <tenantSlugOrId> [--days=365] [--dry-run]');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idArg);
  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('id, name, slug, subscription_plan, subscription_status')
    .or(isUuid ? `id.eq.${idArg}` : `slug.eq.${idArg}`);

  if (error) {
    console.error('Error leyendo tenant:', error.message);
    process.exit(1);
  }
  if (!tenants || tenants.length === 0) {
    console.error(`No se encontró un tenant con ${isUuid ? 'id' : 'slug'} "${idArg}"`);
    process.exit(1);
  }
  if (tenants.length > 1) {
    console.error('Se encontraron varios tenants. Usá el id (uuid) exacto.');
    process.exit(1);
  }

  const tenant = tenants[0];
  const periodEnd = new Date(Date.now() + cycleDays * 24 * 60 * 60 * 1000).toISOString();

  console.log(`\nTenant: #${tenant.id} ${tenant.name} (slug: ${tenant.slug})`);
  console.log(`  Plan actual : ${tenant.subscription_plan} / ${tenant.subscription_status}`);
  console.log(`  Plan destino: enterprise / active`);
  console.log(`  Ciclo       : ${cycleDays} días (vence ${periodEnd.slice(0, 10)})`);
  console.log(`  Dry-run     : ${dryRun ? 'SI (no se ejecutará nada)' : 'NO'}`);

  if (dryRun) return;

  const { error: upErr } = await supabase
    .from('tenants')
    .update({
      subscription_plan: 'enterprise',
      subscription_status: 'active',
      subscription_current_period_end: periodEnd,
    })
    .eq('id', tenant.id);

  if (upErr) {
    console.error('ERROR activando el plan enterprise:', upErr.message);
    process.exit(1);
  }

  console.log('\n✔ Plan Enterprise activado. El cliente queda desbloqueado sin pasar por Mercado Pago.');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
