import { PLANS, getEffectivePrice } from '@/lib/plans';
import { SALES_EMAIL } from '@/lib/tenant-config';

/**
 * Datos estructurados (schema.org) que describen a Vynko como producto.
 *
 * Se emiten UNA sola vez, desde el layout raíz (Server Component), para que
 * toda la app —home, landings y páginas públicas— entregue a los buscadores la
 * misma descripción del software: qué es, en qué categoría entra, dónde opera y
 * a qué precio arranca.
 *
 * Los nodos se enlazan por `@id` estable (no por duplicar el objeto), que es la
 * forma en que Google consolida la entidad entre páginas. Por eso las landings
 * NO repiten el `SoftwareApplication`: lo referencian desde acá.
 *
 * Ojo: no se inventa `aggregateRating` ni reseñas. Google penaliza el marcado
 * de valoraciones que no existen o que no están visibles en la página.
 */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://vynko.dev';

export const ORGANIZATION_ID = `${APP_URL}/#organization`;
export const WEBSITE_ID = `${APP_URL}/#website`;
export const SOFTWARE_APPLICATION_ID = `${APP_URL}/#software`;

const PRODUCT_DESCRIPTION =
  'Plataforma SaaS B2B de gestión de stock en tiempo real, ventas en punto de venta, transferencia multi-sucursal y control comercial para tu negocio.';

const AREA_SERVED = { '@type': 'Country', name: 'Argentina' };

export function buildOrganizationJsonLd(): Record<string, unknown> {
  return {
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: 'Vynko',
    url: APP_URL,
    logo: `${APP_URL}/icons/icon-512.png`,
    email: SALES_EMAIL,
    areaServed: AREA_SERVED,
  };
}

export function buildWebSiteJsonLd(): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    url: APP_URL,
    name: 'Vynko',
    inLanguage: 'es-AR',
    publisher: { '@id': ORGANIZATION_ID },
  };
}

/**
 * El producto en sí. `priceFrom` sale del plan más barato vigente (con la promo
 * aplicada si la hubiera), así el precio publicado nunca queda desfasado del
 * que muestra la landing.
 */
export function buildSoftwareApplicationJsonLd(
  priceFrom: number = getEffectivePrice(PLANS.starter.id)
): Record<string, unknown> {
  return {
    '@type': 'SoftwareApplication',
    '@id': SOFTWARE_APPLICATION_ID,
    name: 'Vynko',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, Android, iOS',
    url: APP_URL,
    description: PRODUCT_DESCRIPTION,
    inLanguage: 'es-AR',
    areaServed: AREA_SERVED,
    offers: {
      '@type': 'Offer',
      price: priceFrom,
      priceCurrency: 'ARS',
      availability: 'https://schema.org/InStock',
      url: `${APP_URL}/#pricing`,
    },
    publisher: { '@id': ORGANIZATION_ID },
  };
}

/** Grafo completo para el `<script type="application/ld+json">` del layout. */
export function buildSiteStructuredData(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      buildOrganizationJsonLd(),
      buildWebSiteJsonLd(),
      buildSoftwareApplicationJsonLd(),
    ],
  };
}

/**
 * Serializa JSON-LD para incrustarlo en un `<script type="application/ld+json">`.
 * Escapa `<` para que un `</script>` dentro de un texto nunca cierre la etiqueta.
 */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
