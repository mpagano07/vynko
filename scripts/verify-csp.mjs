/**
 * Verifica la CSP con nonce contra el server real (no contra el codigo).
 *
 *   npm run build && node scripts/verify-csp.mjs
 *
 * Para cada pagina publica/login:
 *   - el header CSP trae un nonce,
 *   - el nonce es NUEVO en cada request (no se reutiliza),
 *   - `script-src` NO contiene 'unsafe-inline' ni 'unsafe-eval' en produccion,
 *   - todo <script> inline del HTML lleva `nonce=` con ESE valor,
 *   - ningun handler inline (onclick=, ...) se permite sin motivo.
 *
 * Sale con codigo 1 si algo falla, para poder gatear un pipeline.
 */

const BASE = process.env.CSP_VERIFY_BASE_URL ?? 'http://localhost:3999';
const PAGES = ['/login', '/privacidad', '/terminos', '/auth/callback', '/'];

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

function nonceFromCsp(header) {
  const m = /script-src[^;]*'nonce-([^']+)'/.exec(header ?? '');
  return m ? m[1] : null;
}

// Atributos que ejecutan codigo si el atacante logra inyectar HTML. El chequeo
// de que no aparezca ninguno en el HTML renderizado es lo que justifica poner
// `script-src-attr 'none'`: si alguno apareciera, la CSP bloquearia una
// funcionalidad real y hay que enterarse antes de desplegar.
const INLINE_HANDLERS = [
  'onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur',
  'oninput', 'onchange', 'onsubmit', 'onbegin', 'onanimationstart',
  'ontransitionend', 'ontoggle', 'onpointerdown', 'onkeydown', 'onkeyup',
  'onauxclick', 'oncontextmenu', 'ondrag', 'onpaste', 'onwheel',
];

function findInlineHandlers(html) {
  const found = [];
  for (const handler of INLINE_HANDLERS) {
    // Case-insensitive, y sin matchear dentro de otro atributo con el mismo
    // prefijo (por ejemplo "data-onclick=").
    const m = html.match(new RegExp(`(^|\\s)${handler}\\s*=`, 'gi'));
    if (m) found.push(`${handler} x${m.length}`);
  }
  return found;
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  const text = res.headers.get('content-type')?.includes('text/html')
    ? await res.text()
    : '';
  return { res, text, csp: res.headers.get('content-security-policy') };
}

console.log(`objetivo: ${BASE}`);

for (const page of PAGES) {
  console.log(`\n== ${page}`);
  let data;
  try {
    data = await get(page);
  } catch (e) {
    check(`${page} responde`, false, e.message);
    continue;
  }

  const { res, text, csp } = data;
  check(`${page} responde 2xx/3xx`, res.status < 400, `status ${res.status}`);

  if (!csp) {
    check(`${page} tiene header CSP`, false, 'sin Content-Security-Policy');
    continue;
  }
  check(`${page} tiene header CSP`, true);

  const nonce = nonceFromCsp(csp);
  check(`${page} declara nonce en script-src`, Boolean(nonce), csp.slice(0, 120));

  const scriptSrc = (/script-src[^;]*/.exec(csp) ?? [''])[0];
  const isProd = process.env.EXPECT_PROD === '1';
  if (isProd) {
    check(`${page} script-src SIN unsafe-inline`, !scriptSrc.includes("'unsafe-inline'"), scriptSrc);
    check(`${page} script-src SIN unsafe-eval`, !scriptSrc.includes("'unsafe-eval'"), scriptSrc);
    check(`${page} script-src con strict-dynamic`, scriptSrc.includes("'strict-dynamic'"), scriptSrc);
    // Con 'unsafe-hashes' y ningun hash listado la directiva no habilitaba
    // nada, pero dejaba la intention ambigua. Se exige 'none' explicito.
    check(`${page} script-src-attr none`, csp.includes("script-src-attr 'none'"), csp.slice(0, 200));
    check(`${page} SIN unsafe-hashes`, !csp.includes("'unsafe-hashes'"), csp.slice(0, 200));
  }

  check(`${page} object-src none`, csp.includes("object-src 'none'"));
  check(`${page} base-uri self`, csp.includes("base-uri 'self'"));
  check(`${page} frame-ancestors none`, csp.includes("frame-ancestors 'none'"));

  if (nonce) {
    const allScripts = [...text.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);

    // Con 'strict-dynamic' el allowlisting por host queda deshabilitado, asi que
    // un <script src> SIN nonce se bloquea igual que uno inline. Por eso el
    // chequeo es sobre TODOS los tags, no solo los inline.
    const withoutNonce = allScripts.filter((t) => !/nonce="/.test(t));
    check(
      `${page} todo <script> lleva nonce (${allScripts.length} scripts)`,
      withoutNonce.length === 0,
      `sin nonce: ${withoutNonce.slice(0, 2).join(' | ')}`
    );

    const wrongNonce = allScripts.filter((t) => /nonce="([^"]+)"/.test(t) && !t.includes(`nonce="${nonce}"`));
    check(`${page} ningun script con nonce ajeno`, wrongNonce.length === 0, wrongNonce.slice(0, 2).join(' | '));

    const inlineScripts = allScripts.filter((t) => !/\ssrc=/.test(t));
    const inlineStyles = [...text.matchAll(/<style\b[^>]*>/g)].map((m) => m[0]);
    const styleAttrs = (text.match(/ style="/g) ?? []).length;
    console.log(
      `  info ${page}: ${allScripts.length} scripts (${inlineScripts.length} inline), ` +
        `${inlineStyles.length} <style>, ${styleAttrs} style="" (cubiertos por style-src 'unsafe-inline')`
    );

    // El check que el header de este script prometia y no implementaba.
    // Regresion de seguridad: si esto falla, hay que revisar el HTML antes de
    // tocar la CSP.
    const handlers = findInlineHandlers(text);
    check(
      `${page} sin handlers inline (lo que habilita script-src-attr 'none')`,
      handlers.length === 0,
      handlers.join(', ')
    );
  }
}

console.log(`\n== nonce unico por request`);
const a = await get('/login');
const b = await get('/login');
const na = nonceFromCsp(a.csp);
const nb = nonceFromCsp(b.csp);
check('dos requests a /login usan nonces distintos', Boolean(na) && Boolean(nb) && na !== nb, `${na} vs ${nb}`);

console.log(`\n${'='.repeat(60)}`);
console.log(`resultado: ${pass} ok, ${fail} fail`);
if (fail > 0) {
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail > 0 ? 1 : 0);
