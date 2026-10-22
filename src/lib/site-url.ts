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
export function resolveSiteUrl(env: Record<string, string | undefined>): string {
  const raw = (env.NEXT_PUBLIC_SITE_URL ?? env.NEXT_PUBLIC_APP_URL ?? 'https://vynko.dev').trim();
  return raw.replace(/\/+$/, '');
}

export const SITE_URL = resolveSiteUrl(process.env);
