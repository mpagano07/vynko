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
  {
    slug: 'control-de-stock',
    label: 'Control de stock',
    summary: 'Sabé cuántas unidades tenés en cada depósito, con avisos antes de quedarte sin stock.',
    lastModified: '2026-10-22',
  },
  {
    slug: 'ventas-y-caja',
    label: 'Ventas y caja',
    summary: 'Cobrá escaneando el código de barras y cerrá el día con el arqueo ya hecho.',
    lastModified: '2026-10-22',
  },
  {
    slug: 'alternativa-a-excel',
    label: 'Alternativa a Excel',
    summary: 'Dejá la planilla: un sistema que se actualiza solo y no depende de fórmulas.',
    lastModified: '2026-10-22',
  },
  {
    slug: 'software-gestion-argentina',
    label: 'Gestión en Argentina',
    summary: 'Stock, caja y varias sucursales en pesos, con soporte en español.',
    lastModified: '2026-10-22',
  },
  {
    slug: 'importar-productos-mercadolibre-tiendanube',
    label: 'Importar productos',
    summary: 'Subí tu catálogo de Mercado Libre o Tiendanube y empezá a vender el mismo día.',
    lastModified: '2026-10-22',
  },
  {
    slug: 'control-de-compras',
    label: 'Control de compras',
    summary: 'Pedidos al proveedor, remitos de ingreso y stock que se suma solo.',
    lastModified: '2026-10-22',
  },
  {
    slug: 'sistema-para-kiosco',
    label: 'Sistema para kiosco',
    summary: 'Stock, ventas y caja para kioscos y maxikioscos, sin recuentos diarios.',
    lastModified: '2026-10-26',
  },
  {
    slug: 'software-para-ferreteria',
    label: 'Software para ferretería',
    summary: 'Miles de artículos, precios al día y reposición por proveedor en un solo panel.',
    lastModified: '2026-10-26',
  },
  {
    slug: 'sistema-para-distribuidora',
    label: 'Sistema para distribuidora',
    summary: 'Compras, depósitos y ventas mayoristas con stock real en cada sucursal.',
    lastModified: '2026-10-26',
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
  '/precios',
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

/**
 * Directivas de robots para una ruta.
 *
 * Se devuelven SIEMPRE (tambien para las rutas indexables) en vez de omitir
 * el campo: asi el valor se puede auditar leyendo el codigo, en lugar de
 * depender de un default silencioso que puede cambiar entre versiones de
 * Next. `follow` queda en `true` en todos los casos: `noindex, follow` deja a
 * Google recorrer los enlaces de la pagina (util para que descubra el resto
 * del sitio) sin listar esa pagina en el indice.
 */
export function robotsForPath(pathname: string): { index: boolean; follow: true } {
  return { index: isIndexablePath(pathname), follow: true };
}

/** ¿La ruta se renderiza fuera del shell de la app? */
export function isShelllessPath(pathname: string): boolean {
  return matchesPath(pathname, SHELLLESS_PATHS);
}
