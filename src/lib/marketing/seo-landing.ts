import type { Metadata } from 'next';
import { APP_URL, serializeJsonLd } from './structured-data';

export { serializeJsonLd };

/**
 * Registro central de las landings SEO orientadas a intención de búsqueda.
 *
 * Se mantiene acá para que el nav, el footer, el sitemap y los enlaces internos
 * compartan la misma fuente y no aparezcan rutas nuevas sueltas. El `slug` es la
 * ruta pública (`/control-de-stock`), y `label` la etiqueta corta para menús.
 */
export const SEO_PAGES = [
  { slug: 'control-de-stock', label: 'Control de stock' },
  { slug: 'ventas-y-caja', label: 'Ventas y caja' },
  { slug: 'alternativa-a-excel', label: 'Alternativa a Excel' },
  { slug: 'software-gestion-argentina', label: 'Gestión en Argentina' },
  { slug: 'importar-productos-mercadolibre-tiendanube', label: 'Importar productos' },
] as const;

export type SeoPageSlug = (typeof SEO_PAGES)[number]['slug'];

export type SeoProblem = {
  /** El dolor concreto que hoy vive el comercio. */
  problem: string;
  /** Cómo lo resuelve Vynko, en una frase. */
  solution: string;
};

export type SeoFeature = {
  icon: string;
  title: string;
  desc: string;
};

export type SeoFaq = {
  q: string;
  a: string;
};

export type SeoLandingContent = {
  slug: SeoPageSlug;
  /** Título de la pestaña. Sin el sufijo "| Vynko": lo agrega el template del layout. */
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  /** Chip chico arriba del H1. */
  badge: string;
  h1: string;
  intro: string;
  problemsTitle: string;
  problemsIntro: string;
  problems: SeoProblem[];
  featuresTitle: string;
  featuresIntro: string;
  features: SeoFeature[];
  audienceTitle: string;
  audienceIntro: string;
  audience: string[];
  faqTitle: string;
  faq: SeoFaq[];
  finalCtaTitle: string;
  finalCtaText: string;
};

export function seoPath(slug: SeoPageSlug): string {
  return `/${slug}`;
}

/**
 * Metadata por página, alineada a la intención de búsqueda.
 *
 * El `title` va sin el sufijo "| Vynko" a propósito: el template del layout raíz
 * lo agrega una sola vez. Ponerlo acá lo duplicaría.
 */
export function buildSeoMetadata(content: SeoLandingContent): Metadata {
  const path = seoPath(content.slug);

  return {
    title: content.metaTitle,
    description: content.metaDescription,
    keywords: content.keywords,
    alternates: { canonical: path },
    openGraph: {
      title: content.metaTitle,
      description: content.metaDescription,
      url: path,
      siteName: 'Vynko',
      locale: 'es_AR',
      type: 'website',
    },
  };
}

/**
 * Structured data específico de cada landing:
 * - FAQPage: habilita el desplegable de preguntas en los resultados.
 * - BreadcrumbList: la ruta Inicio > página.
 *
 * El `SoftwareApplication` que describe a Vynko NO se repite acá: lo emite el
 * layout raíz una sola vez y se referencia por `@id`. Duplicarlo por página
 * inflaría el HTML y abriría la puerta a que las copias se contradigan.
 *
 * No se inventa `aggregateRating`: Google penaliza reseñas falsas.
 */
export function buildSeoJsonLd(content: SeoLandingContent): Record<string, unknown> {
  const url = `${APP_URL}${seoPath(content.slug)}`;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        mainEntity: content.faq.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.a,
          },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Inicio',
            item: APP_URL,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: content.badge,
            item: url,
          },
        ],
      },
    ],
  };
}
