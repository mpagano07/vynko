import { chromium } from '@playwright/test';
import fs from 'node:fs';

function parseEnv(path) {
  const out = {};
  for (const raw of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const env = parseEnv('.env.local');
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

const started = Date.now();
const log = (...args) => console.log(`+${((Date.now() - started) / 1000).toFixed(2)}s`, ...args);

page.on('framenavigated', (f) => { if (f === page.mainFrame()) log('NAV', f.url()); });
page.on('console', (m) => {
  const t = m.text().slice(0, 240);
  if (m.type() === 'error' || /reload|chunk|hydrat|HMR|Sesión|sesión/i.test(t)) log(`CONSOLE ${m.type()}`, t);
});
page.on('pageerror', (e) => log('PAGEERROR', String(e).slice(0, 240)));
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/') && !u.includes('cb=')) log('API', r.status(), u.replace('http://localhost:3000', '').slice(0, 120));
  else if (r.status() >= 400) log('HTTP', r.status(), u.slice(0, 140));
});

await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(2500);
for (let attempt = 0; attempt < 3; attempt++) {
  await page.locator('#login-email').fill(env.E2E_USER_EMAIL);
  await page.locator('#login-password').fill(env.E2E_USER_PASSWORD);
  await page.waitForTimeout(300);
  const v = await page.evaluate(() => ({ e: document.querySelector('#login-email').value.length, p: document.querySelector('#login-password').value.length }));
  if (v.e > 0 && v.p > 0) break;
}
log('submit');
await page.locator('form button[type=submit]').click();
await page.waitForTimeout(25000);
log('STATE', JSON.stringify(await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 200).replace(/\n+/g, ' | ') }))));
await browser.close();
