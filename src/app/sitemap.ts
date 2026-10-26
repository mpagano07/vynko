import { MetadataRoute } from 'next';
import { SEO_PAGES, seoPath } from '@/lib/marketing/seo-landing';
import { SITE_URL } from '@/lib/site-url';

/**
 * Sitemap de las URLs publicas e indexables.
 *
 * `lastModified` sale del registro de landings (`SEO_PAGES`) y de la fecha real
 * del ultimo cambio de cada pagina legal. Antes se usaba `new Date()`, que
 * cambia en cada request: Google veia un `lastmod` siempre fresco y dejaba de
 * usar la señal para decidir a que conviene volver.
 *
 * Las fechas se actualizan a mano cuando cambia el contenido de la pagina.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const seoLandings: MetadataRoute.Sitemap = SEO_PAGES.map((page) => ({
    url: `${SITE_URL}${seoPath(page.slug)}`,
    lastModified: page.lastModified,
    changeFrequency: 'monthly',
    priority: 0.8,
  }));

  return [
    {
      url: SITE_URL,
      lastModified: '2026-10-22',
      changeFrequency: 'weekly',
      priority: 1,
    },
    ...seoLandings,
    {
      // Precios es la pagina que compite por "precio software de stock" y
      // "cuanto cuesta un sistema de gestion": una consulta de alta intencion
      // que un ancla (`/#pricing`) no puede posicionar por no ser una URL.
      url: `${SITE_URL}/precios`,
      lastModified: '2026-10-26',
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/privacidad`,
      lastModified: '2026-10-21',
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terminos`,
      lastModified: '2026-10-19',
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/reembolsos`,
      lastModified: '2026-10-20',
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/cookies`,
      lastModified: '2026-10-21',
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];
}
