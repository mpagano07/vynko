import { MetadataRoute } from 'next';
import { SEO_PAGES, seoPath } from '@/lib/marketing/seo-landing';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vynko.dev';
  const lastModified = new Date();

  // Landings SEO orientadas a intencion de busqueda. Se derivan del registro
  // central para que una pagina nueva no quede fuera del sitemap sin querer.
  const seoLandings: MetadataRoute.Sitemap = SEO_PAGES.map((page) => ({
    url: `${baseUrl}${seoPath(page.slug)}`,
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.8,
  }));

  return [
    {
      url: baseUrl,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    ...seoLandings,
    {
      url: `${baseUrl}/privacidad`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terminos`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/cookies`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/login`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/auth/signup`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];
}
