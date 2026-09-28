/**
 * Comprueba que la app HIDRATA bajo la CSP con nonce, en un navegador real.
 *
 * Una CSP mal construida no rompe la pagina de forma visible: bloquea los
 * scripts en silencio y el HTML queda como texto muerto. Por eso no alcanza con
 * mirar headers, hay que abrir un Chromium y observar.
 *
 * Dos senales, complementarias:
 *   1. Cero violaciones de CSP en la consola. El navegador reporta cada script
 *      bloqueado, asi que esto detecta regresiones de forma sensible (la primera
 *      version de este script detecto que theme-init.js quedaba bloqueado por
 *      'strict-dynamic').
 *   2. Una interaccion real de React que cambia el DOM. Es la prueba positiva
 *      de hidratacion: si los scripts estuvieran bloqueados, el onClick no
 *      existiria.
 *
 *   node scripts/verify-csp-hydration.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.CSP_VERIFY_BASE_URL ?? 'http://localhost:3999';

/** Pruebas de interaccion por pagina. Sin entrada, solo se chequea que renderiza. */
const INTERACTIONS = {
  '/login': async (page) => {
    const banner = page.locator('button', { hasText: /Rechazar/i }).first();
    if ((await banner.count()) === 0) return { ok: false, detail: 'no aparece el boton de cookies' };
    const before = await page.evaluate(() => document.body.innerHTML.length);
    await banner.click();
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => document.body.innerHTML.length);
    return { ok: before !== after, detail: `html ${before} -> ${after}` };
  },
};

const PAGES = ['/login', '/privacidad', '/'];

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` :: ${detail}` : ''}`);
  }
};

const browser = await chromium.launch();

for (const route of PAGES) {
  console.log(`\n== ${route}`);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(msg.text());
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSPVIOLATION ${e.violatedDirective} ${e.blockedURI}`.slice(0, 200));
    });
  });

  const res = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });

  check(`${route} responde 200`, res?.status() === 200, `status ${res?.status()}`);

  const rendered = await page.evaluate(() => document.body.children.length > 0);
  check(`${route} renderiza contenido`, rendered);

  const isCsp = (t) => /CSPVIOLATION|Content Security Policy/i.test(t);
  const csp = problems.filter(isCsp);
  const others = problems.filter((t) => !isCsp(t));

  check(`${route} sin violaciones de CSP`, csp.length === 0, csp.slice(0, 2).join(' | '));
  check(`${route} consola sin errores`, others.length === 0, others.slice(0, 2).join(' | '));

  const interaction = INTERACTIONS[route];
  if (interaction) {
    const r = await interaction(page);
    check(`${route} React responde a un evento real`, r.ok, r.detail);
  }

  await ctx.close();
}

await browser.close();

console.log(`\n${'='.repeat(60)}\nresultado: ${pass} ok, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
