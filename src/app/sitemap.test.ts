import { describe, expect, it } from 'vitest';
import sitemap from './sitemap';
import { SEO_PAGES, seoPath } from '@/lib/marketing/seo-landing';

describe('sitemap', () => {
  const urls = sitemap().map((entry) => entry.url);

  it('incluye la home', () => {
    expect(urls.some((url) => url.endsWith('vynko.dev'))).toBe(true);
  });

  it('incluye todas las landings SEO del registro', () => {
    for (const page of SEO_PAGES) {
      expect(urls.some((url) => url.endsWith(seoPath(page.slug)))).toBe(true);
    }
  });

  it('no repite URLs', () => {
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('excluye las paginas de auth noindex', () => {
    expect(urls.some((url) => url.endsWith('/login'))).toBe(false);
    expect(urls.some((url) => url.endsWith('/auth/signup'))).toBe(false);
  });
});
