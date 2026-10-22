import type { Metadata } from 'next';
import { APP_URL, serializeJsonLd } from './structured-data';
import { SEO_LANDING_PAGES, type SeoPageSlug } from './public-routes';

export { serializeJsonLd };

/**
 * Registro central de las landings SEO orientadas a intencion de busqueda.
 *
 * Vive en `@/lib/marketing/public-routes` junto con la clasificacion de rutas
 * (publicas, privadas, indexables), para que el nav, el footer, el sitemap y el gate
 * de auth del proxy compartan la misma fuente y no aparezcan rutas nuevas sueltas.
 * El `slug` es la ruta publica (`/control-de-stock`), y `label` la etiqueta
 * corta para menus.
 */
export const SEO_PAGES = SEO_LANDING_PAGES;

export type { SeoPageSlug };

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

/** Un paso de una guia "como hacer X". */
export type SeoStep = {
  title: string;
  desc: string;
};

/** Una fila de la tabla comparativa contra la planilla. */
export type SeoComparisonRow = {
  label: string;
  excel: string;
  vynko: string;
};

/**
 * Enlace interno a otra landing.
 *
 * Se referencia por `slug` (no por href) para que el enlace se resuelva
 * contra el registro de landings y no quede una URL escrita a mano que se
 * pueda romper en silencio.
 */
export type SeoRelatedLink = {
  slug: SeoPageSlug;
  title: string;
  desc: string;
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
  /**
   * H2 + pasos de la guia "como hacer X".
   *
   * Es la seccion que responde las busquedas informativas ("como controlar el
   * stock", "como llevar el inventario sin Excel"). Antes la plantilla tenia
   * una seccion "Empezá en 3 pasos" con el MISMO texto en las cinco landings:
   * no leia como una guia y Google no la podia asociar a ninguna consulta.
   */
  howToTitle: string;
  howToIntro: string;
  howTo: SeoStep[];
  featuresTitle: string;
  featuresIntro: string;
  features: SeoFeature[];
  /** H2 + filas de la comparativa contra la planilla. */
  comparisonTitle: string;
  comparisonIntro: string;
  comparison: SeoComparisonRow[];
  roiTitle: string;
  roiIntro: string;
  audienceTitle: string;
  audienceIntro: string;
  audience: string[];
  pricingTitle: string;
  pricingIntro: string;
  faqTitle: string;
  faq: SeoFaq[];
  /** Landings relacionadas, con anchor contextual. */
  related: SeoRelatedLink[];
  guaranteeTitle: string;
  guaranteeIntro: string;
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
    // El `twitter` del layout raiz se pierde con el merge superficial cuando la
    // landing define su propio `openGraph`, asi que se declara aca: sin esto la
    // card de X/Twitter muestra el titulo de la home en todas las landings.
    twitter: {
      card: 'summary_large_image',
      title: content.metaTitle,
      description: content.metaDescription,
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
