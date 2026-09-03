// Executes with: node scripts/update-prices.mjs
//
// Sincroniza en Mercado Pago el nuevo precio de cada plan para las
// suscripciones (preapprovals) activas. El monto nuevo empieza a
// aplicarse al siguiente cobro recurrente.
//
// Uso:
//   node scripts/update-prices.mjs                        usa los precios de src/lib/prices.json
//   node scripts/update-prices.mjs --business=34900       sobreescribe el precio de un plan
//   node scripts/update-prices.mjs --dry-run              muestra qué haría sin ejecutar cambios
//   node scripts/update-prices.mjs --backfill             recupera los ids de preapproval
//                                                         de clientes activos que no los tienen guardados
//
// Requiere: MERCADOPAGO_ACCESS_TOKEN, SUPABASE_SERVICE_ROLE_KEY y
// NEXT_PUBLIC_SUPABASE_URL en .env.local
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
const { MercadoPagoConfig, PreApproval } = require('mercadopago');
const { createClient } = require('@supabase/supabase-js');

// ---------- Configuración ----------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const currency = process.env.NEXT_PUBLIC_CURRENCY || 'ARS';

if (!supabaseUrl || !serviceRoleKey || !mpToken) {
  console.error('Faltan variables de entorno. Revisa .env.local');
  process.exit(1);
}

// Precios base desde src/lib/prices.json (fuente única de verdad).
const basePrices = require(path.resolve(__dirname, '..', 'src', 'lib', 'prices.json'));

// Sobreescrituras por CLI: --starter=24900 --business=39900
const overrides = {};
for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run') continue;
  if (arg.startsWith('--')) {
    const [k, v] = `${arg.replace(/^--/, '')}`.split('=');
    if (v !== undefined && Number.isFinite(Number(v))) overrides[k] = Number(v);
  }
}

const prices = {};
for (const plan of ['starter', 'business', 'enterprise']) {
  prices[plan] =
    overrides[plan] !== undefined ? overrides[plan] : basePrices[plan];
}

const dryRun = process.argv.includes('--dry-run');
const backfill = process.argv.includes('--backfill');

// ---------- Programa ----------
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const mp = new MercadoPagoConfig({ accessToken: mpToken });
const preApproval = new PreApproval(mp);

// Recupera todos los preapprovals de MP en páginas (status 'authorized').
async function fetchAuthorizedPreApprovals() {
  const results = [];
  const limit = 100;
  let offset = 0;
  for (;;) {
    const res = await preApproval.search({
      options: { status: 'authorized', limit, offset },
    });
    const page = res.results || [];
    results.push(...page);
    const total = res.paging?.total ?? 0;
    offset += limit;
    if (page.length === 0 || offset >= total) break;
  }
  return results;
}

// Rellena mercadopago_preapproval_id para tenants activos sin id guardado,
// matcheando el external_reference (tenant id) de las preaprobaciones.
async function runBackfill() {
  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('id, name, subscription_plan, mercadopago_preapproval_id')
    .eq('subscription_status', 'active');

  if (error) {
    console.error('Error leyendo tenants:', error.message);
    return false;
  }

  const missing = (tenants || []).filter((t) => !t.mercadopago_preapproval_id);
  const enterpriseSkip = missing.filter((t) => t.subscription_plan === 'enterprise');
  const missingToFill = missing.filter((t) => t.subscription_plan !== 'enterprise');
  console.log(`\nBackfill: ${(tenants || []).length} tenants activos, ${missing.length} sin preapproval id guardado`);
  if (enterpriseSkip.length) {
    console.log(`  Omitiendo ${enterpriseSkip.length} enterprise (activados manualmente, sin preapproval MP)`);
  }

  if (missingToFill.length === 0) {
    console.log('No hay nada que backfillear.');
    return true;
  }

  console.log('Buscando preaprobaciones autorizadas en Mercado Pago...');
  const preapprovals = await fetchAuthorizedPreApprovals();
  console.log(`  ${preapprovals.length} preaprobaciones autorizadas encontradas`);

  const byExternalRef = new Map();
  for (const p of preapprovals) {
    if (p.external_reference != null) byExternalRef.set(String(p.external_reference), p.id);
  }

  let filled = 0;
  let notFound = 0;
  for (const tenant of missingToFill) {
    const preapprovalId = byExternalRef.get(tenant.id);
    if (!preapprovalId) {
      notFound++;
      console.log(`  SIN MATCH #${tenant.id} ${tenant.name} (${tenant.subscription_plan})`);
      continue;
    }
    console.log(`  -> #${tenant.id} ${tenant.name} (${tenant.subscription_plan}): ${preapprovalId}`);
    if (dryRun) continue;
    const { error: upErr } = await supabase
      .from('tenants')
      .update({ mercadopago_preapproval_id: preapprovalId })
      .eq('id', tenant.id);
    if (upErr) {
      notFound++;
      console.error(`    ERROR guardando id: ${upErr.message}`);
    } else {
      filled++;
    }
  }

  console.log(`\nBackfill: ${filled} guardados | ${notFound} sin match/error${dryRun ? ' | DRY-RUN (no se guardó nada)' : ''}.`);
  return true;
}

async function main() {
  if (backfill) {
    await runBackfill();
    return;
  }

  console.log(`Currency: ${currency} | Dry-run: ${dryRun ? 'SI' : 'NO'}`);
  console.log('Precios destino:');
  for (const plan of ['starter', 'business', 'enterprise']) {
    console.log(`  ${plan.padEnd(10)} ${prices[plan]}`);
  }

  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('id, name, subscription_plan, mercadopago_preapproval_id')
    .eq('subscription_status', 'active')
    .not('mercadopago_preapproval_id', 'is', null);

  if (error) {
    console.error('Error leyendo tenants:', error.message);
    if (/mercadopago_preapproval_id/.test(error.message || '')) {
      console.error(
        '\nParece que la migración no está aplicada. Ejecuta en el editor SQL de Supabase:\n' +
          "  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mercadopago_preapproval_id TEXT;\n"
      );
    }
    process.exit(1);
  }

  const toUpdate = (tenants || []).filter((t) => prices[t.subscription_plan] !== undefined);

  console.log(
    `\nTenants activos con preapproval: ${(tenants || []).length} | a actualizar: ${toUpdate.length}\n`
  );

  if (toUpdate.length === 0) {
    console.log('No hay nada que actualizar.');
    return;
  }

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const tenant of toUpdate) {
    const id = tenant.mercadopago_preapproval_id;
    const amount = prices[tenant.subscription_plan];
    const label = `#${tenant.id} ${tenant.name} (${tenant.subscription_plan})`;
    console.log(`  -> ${label}: $${amount}`);

    if (dryRun) {
      skipped++;
      continue;
    }

    try {
      await preApproval.update({
        id,
        body: {
          auto_recurring: {
            transaction_amount: amount,
            currency_id: currency,
          },
        },
      });
      updated++;
    } catch (err) {
      errors++;
      console.error(
        `    ERROR en ${tenant.name}: ${err.message || err}`
      );
    }
  }

  console.log(
    `\nResultado: ${updated} actualizados | ${skipped} en dry-run | ${errors} errores.`
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);