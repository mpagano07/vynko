// Executes with: node scripts/indexnow.mjs
//
// Envia URLs a IndexNow, el protocolo que comparten Bing, Yandex, Seznam y
// Naver (Google NO lo usa: para Google queda Search Console). Sirve para que
// una pagina nueva se rastree en horas en vez de esperar a que el crawler
// vuelva solo.
//
// La clave es autogenerada y se demuestra publicandola en
// `https://vynko.dev/<clave>.txt` con la clave como contenido. No es un secreto:
// esta pensada para ser publica. La fuente de verdad es el archivo en `public/`,
// asi que este script lo descubre en vez de duplicar la clave en el codigo.
//
// Uso:
//   node scripts/indexnow.mjs                     envia todas las URLs del sitemap
//   node scripts/indexnow.mjs <url> [<url> ...]   envia solo esas URLs
//   node scripts/indexnow.mjs --dry-run           muestra que enviaria, sin POST
//   node scripts/indexnow.mjs --base http://localhost:3000 --dry-run
//                                                 valida contra un server local
//
// Codigos de respuesta de IndexNow:
//   200 el lote se acepto
//   202 aceptado, pero la clave todavia se esta validando
//   400 formato invalido (URL mal armada o payload incompleto)
//   403 la clave no es valida (el .txt no existe, no coincide o no es accesible)
//   422 las URLs no pertenecen al host declarado, o la clave no coincide
//   429 demasiados requests
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_URLS_PER_REQUEST = 10_000;

// ---------- Argumentos ----------
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');

function readOption(name) {
  const index = argv.indexOf(name);
  return index !== -1 ? argv[index + 1] : undefined;
}

const base = (readOption('--base') ?? 'https://vynko.dev').replace(/\/+$/, '');
const explicitUrls = argv.filter(
  (arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--base'
);

// ---------- Descubrimiento de la clave ----------
/**
 * Busca en `public/` el archivo `<clave>.txt`. Un archivo suelto de 32
 * caracteres hexadecimales con extension `.txt` es la convencion de IndexNow;
 * no hay registro central que consultar.
 */
function findIndexNowKey() {
  const candidates = fs
    .readdirSync(PUBLIC_DIR)
    .filter((name) => /^[0-9a-f]{32}\.txt$/.test(name));

  if (candidates.length === 0) {
    console.error(
      'No hay archivo de clave IndexNow en public/. Se espera un archivo de 32\n' +
        'caracteres hexadecimales con extension .txt cuyo contenido sea la clave.'
    );
    process.exit(1);
  }
  if (candidates.length > 1) {
    console.error(
      `Hay ${candidates.length} archivos de clave IndexNow en public/ (${candidates.join(', ')}).\n` +
        'Tiene que haber uno solo: IndexNow no sabe cual usar.'
    );
    process.exit(1);
  }

  const file = candidates[0];
  const key = path.basename(file, '.txt');
  const content = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8').trim();

  if (content !== key) {
    console.error(
      `El contenido de public/${file} no coincide con el nombre del archivo.\n` +
        `  esperado: ${key}\n  encontrado: ${content}\n` +
        'Bing responde 403 en este caso y no aclara el motivo.'
    );
    process.exit(1);
  }

  return { key, file };
}

// ---------- URLs a enviar ----------
async function urlsFromSitemap() {
  const sitemapUrl = `${base}/sitemap.xml`;
  const res = await fetch(sitemapUrl, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(
      `No se pudo leer ${sitemapUrl} (HTTP ${res.status}). ` +
        'Si el sitio todavia no esta deployado, pasale las URLs a mano.'
    );
  }
  const xml = await res.text();
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  if (urls.length === 0) {
    throw new Error(`${sitemapUrl} no tiene URLs (<loc>).`);
  }
  return urls;
}

async function resolveUrls() {
  if (explicitUrls.length > 0) return explicitUrls;
  return urlsFromSitemap();
}

// ---------- Programa ----------
async function main() {
  const { key, file } = findIndexNowKey();
  const keyLocation = `${base}/${file}`;
  const host = new URL(base).host;

  console.log(`IndexNow | host: ${host} | clave: ${key}${dryRun ? ' | DRY-RUN' : ''}`);
  console.log(`Clave publicada en: ${keyLocation}`);

  // Preflight: si el .txt no esta accesible, IndexNow devuelve un 403 pelado.
  // Mejor detectarlo aca y explicar que falta (casi siempre: deploy pendiente).
  const keyRes = await fetch(keyLocation, { signal: AbortSignal.timeout(15_000) }).catch((err) => {
    throw new Error(`No se pudo pedir ${keyLocation}: ${err.message}`);
  });

  if (!keyRes.ok) {
    const message =
      `El archivo de clave responde HTTP ${keyRes.status}.\n` +
      `  ${keyLocation}\n` +
      'Antes de correr esto, el archivo tiene que estar deployado: mergea el PR\n' +
      'y espera a que Vercel termine. Si ya deployaste, revisa que el proxy no\n' +
      'lo este redirigiendo a /login.';
    if (dryRun) console.warn(`\nAVISO: ${message}`);
    else throw new Error(message);
  } else {
    const published = (await keyRes.text()).trim();
    if (published !== key && !dryRun) {
      throw new Error(
        `El archivo publicado no contiene la clave.\n  esperado: ${key}\n  encontrado: ${published}`
      );
    }
    console.log('Preflight: la clave se sirve correctamente.');
  }

  const urls = await resolveUrls();
  const invalid = urls.filter((url) => !url.startsWith(`${base}/`) && url !== base);
  if (invalid.length > 0) {
    // IndexNow valida host + clave juntos: una URL de otro dominio hace fallar
    // el lote entero con 422, sin decir cual sobra.
    throw new Error(
      `Estas URLs no pertenecen a ${host}:\n  ${invalid.join('\n  ')}\n` +
        'IndexNow rechaza el lote completo si una sola no coincide con el host.'
    );
  }

  console.log(`\n${urls.length} URL(s) a enviar:`);
  for (const url of urls) console.log(`  ${url}`);

  const payload = { host, key, keyLocation, urlList: urls };

  if (dryRun) {
    console.log('\nDRY-RUN: no se envio nada. Payload que se usaria:');
    console.log(JSON.stringify({ ...payload, urlList: `${urls.length} URLs` }, null, 2));
    return;
  }

  if (urls.length > MAX_URLS_PER_REQUEST) {
    throw new Error(
      `${urls.length} URLs supera el maximo de ${MAX_URLS_PER_REQUEST} por request.`
    );
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });

  const accepted = res.status === 200 || res.status === 202;
  console.log(`\nIndexNow respondio HTTP ${res.status}${accepted ? ' (aceptado)' : ''}.`);

  if (!accepted) {
    const hints = {
      400: 'Formato invalido: revisa que las URLs sean absolutas y empiecen con https://',
      403: 'Clave invalida: el .txt no existe, no coincide o no es accesible publicamente.',
      422: 'Host o clave en desacuerdo con el .txt, o alguna URL no pertenece al host.',
      429: 'Demasiados envios seguidos. Espera unos minutos.',
    };
    if (hints[res.status]) console.error(`  ${hints[res.status]}`);
    const body = await res.text().catch(() => '');
    if (body) console.error(`  ${body.slice(0, 300)}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
