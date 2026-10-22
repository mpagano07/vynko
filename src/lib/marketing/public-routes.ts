/**
 * Rutas publicas y privadas de Vynko: fuente unica de verdad.
 *
 * Antes esta informacion estaba duplicada en tres lugares:
 *
 *  - `src/proxy.ts` (lista `publicPaths`): decide si una ruta se sirve sin
 *    sesion.
 *  - `src/components/layout/ClientLayoutWrapper.tsx`: decide si la pagina se
 *    renderiza fuera del shell de la app (sin sidebar).
 *  - `src/app/robots.ts` (lista `DISALLOW`): decide que rutas no se rastrean.
 *
 * Tres copias de la misma informacion que se pueden desincronizar sin que
 * nadie se entere. Este modulo las reemplaza: cada consumidor pregunta aca.
 *
 * Hay TRES conceptos distintos que antes estaban mezclados:
 *
 *  1. `PUBLIC_PATHS`: se sirven SIN sesion. El gate de auth del proxy las deja
 *     pasar. `/auth/*` entra aca porque recuperar la clave y aceptar una
 *     invitacion tienen que funcionar sin haber iniciado sesion.
 *  2. `NOINDEX_PATHS`: son publicas pero NO deben entrar al indice (login,
 *     signup, reset de contrasena, invitacion, "sin acceso"). Se sirven bien,
 *     solo que se marcan `noindex` para que los buscadores no las compitan con
 *     las landings.
 *  3. `SHELLLESS_PATHS`: se renderizan fuera del shell de la app (sin sidebar
 *     ni header). Incluye las publicas mas `/onboarding`, que exige sesion
 *     pero se muestra como pantalla de bienvenida, no como pagina del panel.
 */

/**
 * Landings SEO orientadas a intencion de busqueda.
 *
 * Este es el REGISTRO: de acá salen la lista de rutas publicas, el nav, el
 * footer, el sitemap y el mapa de keywords. Agregar una landing es agregar una
 * entrada aca y crear el route dir.
 *
 * `lastModified` es la fecha del ultimo cambio de CONTENIDO de la pagina, y
 * es lo que se publica como `lastmod` en el sitemap.xml. Hay que tocarlo
 * cuando se edita el copy de la landing: Google usa esa fecha para decidir si
 * vale la pena volver a rastrear. No es la fecha del build (si lo fuera,
 * todos los `lastmod` serian siempre "hoy" y la señal no valdria nada).
 */
export const SEO_LANDING_PAGES = [
  { slug: 'control-de-stock', label: 'Control de stock', lastModified: '2026-10-22' },
  { slug: 'ventas-y-caja', label: 'Ventas y caja', lastModified: '2026-10-22' },
  { slug: 'alternativa-a-excel', label: 'Alternativa a Excel', lastModified: '2026-10-22' },
  {
    slug: 'software-gestion-argentina',
    label: 'Gestión en Argentina',
    lastModified: '2026-10-22',
  },
  {
    slug: 'importar-productos-mercadolibre-tiendanube',
    label: 'Importar productos',
    lastModified: '2026-10-22',
  },
] as const;

export type SeoPageSlug = (typeof SEO_LANDING_PAGES)[number]['slug'];

/** Rutas de las landings SEO (con barra inicial), derivadas del registro. */
export const SEO_LANDING_PATHS: readonly string[] = SEO_LANDING_PAGES.map((page) => '/' + page.slug);

/** Paginas legales publicas. */
export const LEGAL_PATHS = ['/privacidad', '/terminos', '/reembolsos', '/cookies'] as const;

/**
 * Rutas que se sirven sin sesion.
 *
 * `/opengraph-image` y `/twitter-image` no son paginas: son las imagenes OG
 * generadas por `next/og`. No tienen punto en la ruta, asi que el matcher del
 * proxy las incluiria y el gate de auth las mandaria a `/login`: los
 * crawlers de redes sociales (WhatsApp, LinkedIn, X) recibirian HTML en vez
 * del PNG. Son publicas por definicion.
 */
export const PUBLIC_PATHS: readonly string[] = [
  '/',
  '/login',
  '/auth',
  '/accept-invite',
  '/no-access',
  ...LEGAL_PATHS,
  ...SEO_LANDING_PATHS,
  '/opengraph-image',
  '/twitter-image',
];

/**
 * Rutas publicas que no deben indexarse.
 *
 * Bloquearlas con `Disallow` en robots.txt seria contraproducente: si Google
 * no puede rastrear la URL, tampoco puede leer el `noindex` que la saca del
 * indice. Por eso van `noindex` (via `isIndexablePath`) y NO en la lista de
 * `Disallow`.
 */
export const NOINDEX_PATHS: readonly string[] = [
  '/login',
  '/auth',
  '/accept-invite',
  '/no-access',
];

/**
 * Rutas de la app que exigen sesion. Se usan para el `Disallow` de
 * robots.txt: no aportan nada al indice y ademas gastarian presupuesto de
 * rastreo.
 *
 * No llevan barra final a proposito: en robots.txt `Disallow: /dashboard/`
 * NO bloquea `https://site/dashboard` (la ruta plana), solo sus subrutas. Con
 * el prefijo sin barra se bloquean las dos formas.
 */
export const PRIVATE_ROUTE_PREFIXES: readonly string[] = [
  '/api',
  '/dashboard',
  '/sales',
  '/products',
  '/providers',
  '/customers',
  '/documents',
  '/invoices',
  '/forecast',
  '/loss-prevention',
  '/activity-logs',
  '/qr-codes',
  '/scanning',
  '/settings',
  '/billing',
  '/onboarding',
  '/admin',
  '/ai',
  '/shelf-vision',
];

/**
 * Rutas que se renderizan fuera del shell de la app (sin sidebar ni header).
 *
 * Son las publicas mas `/onboarding`: el gate de auth del proxy la exige
 * (tiene su propio control de suscripcion), pero visualmente es una pantalla
 * de bienvenida, no una pagina del panel.
 */
export const SHELLLESS_PATHS: readonly string[] = [...PUBLIC_PATHS, '/onboarding'];

/**
 * Coincidencia por prefijo de ruta, con frontera de segmento.
 *
 * `pathname === prefix || pathname.startsWith(prefix + '/')`. Asi `/auth`
 * cubre `/auth` y `/auth/signup`, pero no `/author`.
 */
export function matchesPath(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}

/** ¿La ruta se sirve sin sesion? */
export function isPublicPath(pathname: string): boolean {
  return matchesPath(pathname, PUBLIC_PATHS);
}

/** ¿La ruta es publica y ademas puede entrar al indice de los buscadores? */
export function isIndexablePath(pathname: string): boolean {
  return isPublicPath(pathname) && !matchesPath(pathname, NOINDEX_PATHS);
}

/** ¿La ruta se renderiza fuera del shell de la app? */
export function isShelllessPath(pathname: string): boolean {
  return matchesPath(pathname, SHELLLESS_PATHS);
}
