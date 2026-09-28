/**
 * Content Security Policy con nonce por request.
 *
 * Por que nonce y no 'unsafe-inline': Next inyecta el payload de RSC
 * (`self.__next_f.push`) como script INLINE, asi que con `script-src 'self'`
 * la app no hidrata. El nonce es lo unico que permite esos scripts sin
 * reabrir la puerta a HTML inyectado: un atacante tendria que adivinar un
 * valor aleatorio distinto en cada response.
 *
 * Decisiones:
 * - `strict-dynamic` va solo en produccion. En navegadores que lo soportan hace
 *   que la lista de hosts de `script-src` se ignore a favor de los scripts
 *   cargados por scripts con nonce, que es la forma estricta. En desarrollo
 *   molestaria (HMR, React DevTools) sin aportar seguridad.
 * - `style-src` conserva 'unsafe-inline': React aplica estilos con el atributo
 *   `style`, que lo gobierna `style-src-attr` (que cae en `style-src`). Sin
 *   'unsafe-inline' se romperian todas las barras de progreso, anchos y
 *   posicionamiento dinamico. Inyectar CSS no es primitivo de ejecucion de
 *   codigo, asi que el riesgo residual es bajo.
 * - Los host lists se conservan para navegadores sin soporte de 'strict-dynamic'.
 * - `script-src-attr 'none'`: antes era 'unsafe-hashes', pero SIN ningun hash
 *   listado, y eso no hacia nada: 'unsafe-hashes' solo habilita un handler inline
 *   cuyo valor coincida con un hash declarado, asi que sin hashes no habilita
 *   ninguno. La directiva era ademas engañosa, porque el comentario que la
 *   acompañaba decia que allowlistaba los handlers de React, y no es cierto: React
 *   no emite atributos de evento, engancha los handlers con delegacion en la raiz,
 *   asi que nunca hay `onclick=` en el HTML. 'none' dice exactamente lo que se
 *   quiso decir. Verificado con `scripts/scan-inline-handlers.mjs` contra el server
 *   real: cero atributos de evento inline en el HTML renderizado.
 *
 * Ver `scripts/verify-csp.mjs`, que comprueba contra el server real que todo
 * script inline de la pagina lleva el nonce vigente.
 */
export function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production';
  const strictDynamic = isDev ? '' : " 'strict-dynamic'";

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${strictDynamic}${isDev ? " 'unsafe-eval'" : ''}`,
    // Los handlers inline (onclick=, onload=, ...) quedan en 'none'. React no los
    // emite nunca (usa delegacion), asi que no se rompe nada y se cierra la via
    // de ejecutar codigo desde un atributo inyectado.
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://*.supabase.co https://*.supabase.in https://*.mercadopago.com https://http2.mlstatic.com https://*.gravatar.com https://images.unsplash.com",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "frame-src https://*.mercadopago.com",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ];

  return directives.join('; ');
}
