import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vynko.app';

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/dashboard/',
        '/settings/',
        '/onboarding/',
        '/products/',
        '/sales/',
        '/customers/',
        '/providers/',
        '/documents/',
        '/billing/',
        '/reports/',
        '/scanning/',
        '/transfers/',
        '/loss-prevention/',
        '/collaborators/',
        '/accept-invite/',
        '/reset-password',
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
