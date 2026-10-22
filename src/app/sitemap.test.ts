import { describe, expect, it } from 'vitest';
import sitemap from './sitemap';
import { SEO_PAGES, seoPath } from '@/lib/marketing/seo-landing';
import { isIndexablePath } from '@/lib/marketing/public-routes';
import { SITE_URL } from '@/lib/site-url';

describe('sitemap', () => {
  const entries = sitemap();
  const urls = entries.map((entry) => entry.url);

  it('incluye la home', () => {
    expect(urls).toContain(SITE_URL);
  });

  it('incluye todas las landings SEO del registro', () => {
    for (const page of SEO_PAGES) {
      expect(urls).toContain(`${SITE_URL}${seoPath(page.slug)}`);
    }
  });

  it('no repite URLs', () => {
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('excluye las paginas de auth noindex', () => {
    expect(urls.some((url) => url.endsWith('/login'))).toBe(false);
    expect(urls.some((url) => url.endsWith('/auth/signup'))).toBe(false);
  });

  it('publica un lastmod real y no la fecha del request', () => {
    // Con `new Date()` cada respuesta traia un `lastmod` distinto y Google
    // dejaba de usar la senal. Ademas, dos `lastmod` del mismo dia para
    // paginas distintas tambien es senal de que el dato no significa nada.
    for (const entry of entries) {
      expect(entry.lastModified).toBeDefined();
      const asDate = new Date(entry.lastModified as string);
      expect(Number.isNaN(asDate.getTime())).toBe(false);
      expect(asDate.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });

  it('usa la misma base que los canonicals', () => {
    for (const url of urls) {
      expect(url.startsWith(SITE_URL)).toBe(true);
    }
  });

  it('publica SOLO URLs que se pueden indexar', () => {
    // Publicar en el sitemap una URL con `noindex` es una contradiccion: se le
    // dice a Google "indexa esto" y al mismo tiempo "no lo indexes". Este test
    // ata el sitemap con la clasificacion de rutas, que es la fuente unica.
    for (const url of urls) {
      const path = url === SITE_URL ? '/' : url.slice(SITE_URL.length);
      expect(isIndexablePath(path), `${path} esta en el sitemap pero no es indexable`).toBe(true);
    }
  });
});
