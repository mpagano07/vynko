// Ejecutar con: node scripts/paddle-bootstrap.mjs
//
// Crea en Paddle (sandbox o producción según PADDLE_ENVIRONMENT) los productos
// "Starter" y "Business" con un precio recurrente mensual por moneda, y opcional-
// mente el destination de webhooks. Al final imprime el JSON de PADDLE_PRICE_IDS
// y el PADDLE_WEBHOOK_SECRET listos para pegar en .env.local.
//
// Es idempotente: si un producto ya existe (mismo nombre) lo reutiliza, y si un
// precio de esa moneda ya existe para el producto, lo saltea. Se puede correr
// varias veces sin duplicar catálogo.
//
// Uso:
//   node scripts/paddle-bootstrap.mjs
//   node scripts/paddle-bootstrap.mjs --dry-run
//   node scripts/paddle-bootstrap.mjs --webhook https://xxxx.ngrok.app/api/webhooks/paddle
//   node scripts/paddle-bootstrap.mjs --env .env.prod.local
//
// Requiere: PADDLE_API_KEY (en .env.local o el archivo pasado con --env).
// Opcional: PADDLE_ENVIRONMENT (sandbox|production, default sandbox).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------- Carga de variables de entorno ----------
function loadEnv(file) {
  if (!fs.existsSync(file)) return false;
  const content = fs.readFileSync(file, 'utf8');
  for (const line of content.split('\n')) {
    const matched = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!matched) continue;
    const key = matched[1];
    let val = (matched[2] ?? '').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return true;
}

// ---------- Args ----------
const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const DRY_RUN = args.includes('--dry-run');
const WEBHOOK_URL = argValue('--webhook') ?? process.env.PADDLE_WEBHOOK_URL ?? null;
const ENV_FILE = argValue('--env') ?? '.env.local';

loadEnv(path.join(ROOT, ENV_FILE));

// ---------- Config ----------
const API_BASE =
  (process.env.PADDLE_ENVIRONMENT || 'sandbox').toLowerCase() === 'production'
    ? 'https://api.paddle.com'
    : 'https://sandbox-api.paddle.com';
const API_KEY = process.env.PADDLE_API_KEY;

const TAX_CATEGORY = 'saas';

// Producto y sus precios por moneda. El monto va en la unidad mínima de la
// moneda (pesos ×100, salvo CLP que no tiene decimales). Deben coincidir con
// PRICES_BY_COUNTRY (src/lib/pricing/prices-by-country.ts).
const PLANS = {
  Starter: { starter: true },
  Business: { business: true },
};

// [moneda, decimales, precioStarter, precioBusiness]
const PRICES = [
  ['USD', 2, 17, 25],
  ['COP', 2, 69900, 109000],
  ['MXN', 2, 299, 449],
  ['CLP', 0, 15990, 23990],
  ['BRL', 2, 89, 139],
  ['PEN', 2, 65, 99],
];

const SUBSCRIBED_EVENTS = [
  'transaction.completed',
  'subscription.created',
  'subscription.activated',
  'subscription.trialing',
  'subscription.updated',
  'subscription.past_due',
  'subscription.paused',
  'subscription.resumed',
  'subscription.canceled',
];

// ---------- Cliente ----------
async function paddle(method, endpoint, body) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = json?.error?.detail || json?.error?.code || res.statusText;
    throw new Error(`${method} ${endpoint} → ${res.status}: ${detail}`);
  }
  return json;
}

function toMinorUnits(amount, decimals) {
  return String(Math.round(amount * 10 ** decimals));
}

async function ensureProduct(name) {
  const list = await paddle('GET', `/products?status=active&per_page=200`);
  const existing = list?.data?.find((p) => p.name === name);
  if (existing) {
    console.log(`  = producto ya existe: ${name} (${existing.id})`);
    return existing.id;
  }
  if (DRY_RUN) {
    console.log(`  + [dry-run] crearía producto: ${name}`);
    return `pro_dry_${name.toLowerCase()}`;
  }
  const created = await paddle('POST', '/products', {
    name,
    tax_category: TAX_CATEGORY,
    description: `Plan ${name} de Vynko`,
  });
  console.log(`  + producto creado: ${name} (${created.data.id})`);
  return created.data.id;
}

async function ensurePrice(productId, planName, currency, decimals, amount) {
  const list = await paddle('GET', `/prices?product_id=${productId}&status=active&per_page=200`);
  const existing = list?.data?.find(
    (p) => p.unit_price?.currency_code === currency && p.billing_cycle
  );
  if (existing) {
    console.log(`  = precio ya existe: ${planName} ${currency} (${existing.id})`);
    return existing.id;
  }
  if (DRY_RUN) {
    console.log(`  + [dry-run] crearía precio: ${planName} ${currency} = ${amount}`);
    return `pri_dry_${planName.toLowerCase()}_${currency.toLowerCase()}`;
  }
  const created = await paddle('POST', '/prices', {
    product_id: productId,
    description: `${planName} ${currency} mensual`,
    name: `${planName} (${currency})`,
    unit_price: { amount: toMinorUnits(amount, decimals), currency_code: currency },
    billing_cycle: { interval: 'month', frequency: 1 },
  });
  console.log(`  + precio creado: ${planName} ${currency} (${created.data.id})`);
  return created.data.id;
}

async function ensureWebhook(url) {
  const list = await paddle('GET', '/notification-settings');
  const existing = list?.data?.find((d) => d.destination === url);
  if (existing) {
    console.log(`  = webhook ya existe para ${url}`);
    return null;
  }
  if (DRY_RUN) {
    console.log(`  + [dry-run] crearía webhook → ${url}`);
    return 'pdl_ntfset_dry_run';
  }
  const created = await paddle('POST', '/notification-settings', {
    description: 'Vynko webhooks',
    type: 'url',
    destination: url,
    subscribed_events: SUBSCRIBED_EVENTS,
  });
  return created.data.endpoint_secret_key;
}

// ---------- Main ----------
async function main() {
  console.log(`Paddle bootstrap → ${API_BASE}${DRY_RUN ? '  [DRY-RUN]' : ''}\n`);

  if (!API_KEY) {
    console.error(`Falta PADDLE_API_KEY. Agregala en ${ENV_FILE} y volvé a correr.`);
    process.exit(1);
  }

  const productIds = {};
  for (const name of Object.keys(PLANS)) {
    productIds[name] = await ensureProduct(name);
  }

  const priceIds = {};
  for (const [currency, decimals, starter, business] of PRICES) {
    priceIds[currency] = {};
    console.log(`\nMoneda ${currency}:`);
    priceIds[currency].starter = await ensurePrice(
      productIds.Starter,
      'Starter',
      currency,
      decimals,
      starter
    );
    priceIds[currency].business = await ensurePrice(
      productIds.Business,
      'Business',
      currency,
      decimals,
      business
    );
  }

  let webhookSecret = null;
  if (WEBHOOK_URL) {
    console.log(`\nWebhook:`);
    webhookSecret = await ensureWebhook(WEBHOOK_URL);
  }

  console.log('\n\n===== PEGAR EN .env.local =====\n');
  console.log(`PADDLE_ENVIRONMENT=${(process.env.PADDLE_ENVIRONMENT || 'sandbox').toLowerCase()}`);
  console.log(`PADDLE_PRICE_IDS=${JSON.stringify(priceIds)}`);
  if (webhookSecret) {
    console.log(`PADDLE_WEBHOOK_SECRET=${webhookSecret}`);
  } else if (WEBHOOK_URL) {
    console.log('# Webhook ya existía: copiá el secret desde el panel o recreá el destination.');
  } else {
    console.log('# PADDLE_WEBHOOK_SECRET=<pasá --webhook <url> para crearlo automáticamente>');
  }
  console.log('\n================================');
}

main().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
