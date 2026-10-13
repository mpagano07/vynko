import { describe, expect, it } from 'vitest';
import {
  SEO_PAGES,
  buildSeoJsonLd,
  buildSeoMetadata,
  seoPath,
  serializeJsonLd,
  type SeoLandingContent,
} from './seo-landing';

const content: SeoLandingContent = {
  slug: 'control-de-stock',
  metaTitle: 'Control de stock para pequeños comercios',
  metaDescription: 'Sistema de control de stock para pequeños comercios.',
  keywords: ['control de stock'],
  badge: 'Control de stock',
  h1: 'Control de stock para pequeños comercios',
  intro: 'Intro',
  problemsTitle: 'Problemas',
  problemsIntro: 'Intro',
  problems: [{ problem: 'Falta stock', solution: 'Alerta de reposición' }],
  featuresTitle: 'Funcionalidades',
  featuresIntro: 'Intro',
  features: [{ icon: '📦', title: 'Stock', desc: 'Desc' }],
  audienceTitle: 'Para quién',
  audienceIntro: 'Intro',
  audience: ['Almacenes'],
  faqTitle: 'FAQ',
  faq: [
    { q: '¿Pregunta 1?', a: 'Respuesta 1' },
    { q: '¿Pregunta 2?', a: 'Respuesta 2' },
  ],
  finalCtaTitle: 'Empezá',
  finalCtaText: 'Texto',
};

describe('registro de landings SEO', () => {
  it('no repite slugs', () => {
    const slugs = SEO_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('arma la ruta publica con barra inicial', () => {
    expect(seoPath('ventas-y-caja')).toBe('/ventas-y-caja');
  });
});

describe('buildSeoMetadata', () => {
  const metadata = buildSeoMetadata(content);

  it('usa el titulo sin duplicar el sufijo "Vynko" (lo agrega el template)', () => {
    expect(metadata.title).toBe('Control de stock para pequeños comercios');
  });

  it('declara el canonical de la propia ruta', () => {
    expect(metadata.alternates?.canonical).toBe('/control-de-stock');
  });

  it('carga keywords y open graph', () => {
    expect(metadata.keywords).toContain('control de stock');
    expect(metadata.openGraph).toBeDefined();
  });
});

describe('buildSeoJsonLd', () => {
  const jsonLd = buildSeoJsonLd(content) as {
    '@graph': Array<Record<string, unknown>>;
  };

  it('incluye FAQPage y BreadcrumbList (lo específico de la página)', () => {
    const types = jsonLd['@graph'].map((node) => node['@type']);
    expect(types).toContain('FAQPage');
    expect(types).toContain('BreadcrumbList');
  });

  it('NO repite SoftwareApplication: lo emite el layout una sola vez', () => {
    const types = jsonLd['@graph'].map((node) => node['@type']);
    expect(types).not.toContain('SoftwareApplication');
  });

  it('vuelca todas las preguntas en la FAQPage', () => {
    const faq = jsonLd['@graph'].find((node) => node['@type'] === 'FAQPage') as {
      mainEntity: unknown[];
    };
    expect(faq.mainEntity).toHaveLength(content.faq.length);
  });

  it('escapa "<" para que un texto nunca cierre el script', () => {
    const serialized = serializeJsonLd({ text: '</script><script>alert(1)</script>' });
    expect(serialized).not.toContain('</script>');
    expect(serialized).toContain('\\u003c');
  });
});
