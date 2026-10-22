import { MetadataRoute } from 'next';
import { PRIVATE_ROUTE_PREFIXES } from '@/lib/marketing/public-routes';
import { SITE_URL } from '@/lib/site-url';

/**
 * Rutas privadas de la app: no aportan nada al indice y quedan detras del gate
 * de auth (redirect a /login), asi que se excluyen del rastreo para todos los
 * agentes. Se comparten entre el bloque de OAI-SearchBot y el generico para que
 * no se puedan desincronizar.
 *
 * La lista sale de `PRIVATE_ROUTE_PREFIXES` (`@/lib/marketing/public-routes`),
 * que es la misma fuente de verdad que usa el gate de auth del proxy: si se
 * agrega una ruta privada a la app, queda fuera del indice automaticamente.
 *
 * Los prefijos van SIN barra final a proposito: en robots.txt
 * `Disallow: /dashboard/` NO bloquea `https://site/dashboard` (la ruta
 * plana), solo sus subrutas. Con el prefijo sin barra se bloquean las dos
 * formas.
 *
 * Las rutas publicas que no deben indexarse (login, signup, reset de
 * contrasena, invitacion, "sin acceso") NO van aqui: se sirven con
 * `noindex` desde el layout raiz. Si Google no puede rastrear la URL, tampoco
 * puede leer el `noindex` que la saca del indice.
 */
export default function robots(): MetadataRoute.Robots {
  // Next tipa `disallow` como `string[]` mutable, asi que se copia la lista
  // readonly del registro en vez de exponerla.
  const disallow = [...PRIVATE_ROUTE_PREFIXES];

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
        disallow,
      },
      {
        userAgent: '*',
        allow: '/',
        disallow,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
