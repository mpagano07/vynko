import { chromium } from '@playwright/test';

const url = process.argv[2] || 'http://localhost:3000/login';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

const started = Date.now();
const log = (...args) => console.log(`+${((Date.now() - started) / 1000).toFixed(2)}s`, ...args);

page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) log('NAV', frame.url());
});
page.on('console', (m) => {
  const text = m.text().slice(0, 300);
  if (m.type() === 'error' || m.type() === 'warning') log(`CONSOLE ${m.type()}`, text);
  else if (/HMR|Fast Refresh|reload|hydrat|chunk/i.test(text)) log('CONSOLE log', text);
});
page.on('pageerror', (e) => log('PAGEERROR', String(e).slice(0, 300)));
page.on('response', (r) => {
  const u = r.url();
  if (r.status() >= 400) log('HTTP', r.status(), u.slice(0, 160));
});
page.on('websocket', (ws) => {
  log('WS OPEN', ws.url());
  ws.on('close', () => log('WS CLOSE', ws.url()));
  ws.on('socketerror', (e) => log('WS ERROR', String(e)));
});
context.on('page', (p) => log('NEW PAGE', p.url()));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(15000);

const state = await page.evaluate(() => ({
  url: location.href,
  sw: navigator.serviceWorker ? (navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : 'none') : 'unsupported',
  caches: typeof caches !== 'undefined' ? 'yes' : 'no',
}));
log('STATE', JSON.stringify(state));
await browser.close();
