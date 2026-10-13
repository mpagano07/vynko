import { MetadataRoute } from 'next';

/**
 * Rutas privadas de la app: no aportan nada al indice y quedan detras del gate
 * de auth (redirect a /login), asi que se excluyen del rastreo para todos los
 * agentes. Se comparten entre el bloque de OAI-SearchBot y el generico para que
 * no se puedan desincronizar.
 */
const DISALLOW = [
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
];

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vynko.dev';

  return {
    rules: [
      // OAI-SearchBot es el rastreador con el que OpenAI descubre paginas para
      // los resultados de busqueda de ChatGPT. Sin un bloque explicito que le
      // permita "/" el sitio puede quedar fuera de esas respuestas. El bloque
      // especifico tiene prioridad sobre el comodin y conserva los mismos
      // Disallow que el resto, asi que no reemplaza las reglas de las demas
      // rutas ni rastreadores.
      {
        userAgent: 'OAI-SearchBot',
        allow: '/',
        disallow: DISALLOW,
      },
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOW,
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
