/**
 * URL publica de la app: fuente unica de verdad.
 *
 * Antes cada archivo SEO (layout raiz, robots.txt, sitemap.xml, JSON-LD) leia
 * `NEXT_PUBLIC_APP_URL` por su cuenta, y los redirects de seguridad usaban
 * `NEXT_PUBLIC_SITE_URL`. Con dos variables para lo mismo, era facil que una
 * quedara sin definir en produccion y todo el SEO apuntara al fallback
 * equivocado. Ahora hay una sola lectura, y el orden de preferencia es
 * explicito:
 *
 *  1. `NEXT_PUBLIC_SITE_URL` — la que documenta `.env.example` y la que ya
 *     usan los redirects para validar el origen de las URLs.
 *  2. `NEXT_PUBLIC_APP_URL` — alias historico, por si en algun entorno solo
 *     esta definida esa.
 *  3. `https://vynko.dev` — fallback de produccion.
 *
 * Se normaliza sin barra final para poder concatenar rutas sin duplicar la
 * separacion (`${SITE_URL}/sitemap.xml`).
 */

/** Dominio canonico de produccion. Es un dato estable, no un secreto. */
const DEFAULT_SITE_URL = 'https://vynko.dev';

/**
 * Hosts que NUNCA son el dominio canonico.
 *
 * Los Preview Deployments de Vercel cuelgan de `*.vercel.app`. Si una variable
 * de entorno quedara apuntando ahi (copiada de un preview, o de un entorno de
 * pruebas), los canonicals, el sitemap y los JSON-LD apuntarian a una URL que
 * no es el sitio publico y que ademas Vercel marca con `noindex`. Es un fallo
 * silencioso: el sitio responde 200 y el error solo se ve en Search Console.
 *
 * `localhost` NO se filtra: en desarrollo el canonical tiene que apuntar al
 * entorno local.
 */
function isPreviewHost(hostname: string): boolean {
  return hostname.endsWith('.vercel.app');
}

/**
 * Resuelve la URL canonica del sitio.
 *
 * Descarta los valores que no sirven, en este orden:
 *
 *  - vacios o solo espacios. Una variable DEFINIDA pero VACIA (que es
 *    exactamente como viene en `.env.example`) no cuenta como definida:
 *    `??` no salta los strings vacios, asi que antes `resolveSiteUrl` podia
 *    devolver `''`, y `new URL('')` revienta. Como el layout raiz hace
 *    `metadataBase: new URL(SITE_URL)` al cargar el modulo, eso era un crash
 *    de build (o un render roto) esperando a que alguien copiara `.env.example`
 *    a `.env.local` sin completar el valor.
 *  - hosts de preview de Vercel (`*.vercel.app`).
 *  - URLs que no parsean.
 */
export function resolveSiteUrl(env: Record<string, string | undefined>): string {
  const candidates = [env.NEXT_PUBLIC_SITE_URL, env.NEXT_PUBLIC_APP_URL];

  for (const candidate of candidates) {
    const raw = candidate?.trim();
    if (!raw) continue;

    const normalized = raw.replace(/\/+$/, '');
    try {
      const { hostname } = new URL(normalized);
      if (isPreviewHost(hostname)) continue;
      return normalized;
    } catch {
      // URL invalida: se ignora y se prueba el siguiente candidato.
    }
  }

  return DEFAULT_SITE_URL;
}

export const SITE_URL = resolveSiteUrl(process.env);
