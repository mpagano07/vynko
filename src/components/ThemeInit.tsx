import { headers } from 'next/headers';

/**
 * Aplica el tema antes del primer paint para evitar el flash de tema claro.
 *
 * El script vive en `public/theme-init.js` y se carga como recurso externo
 * (same-origin) desde el `<head>` del layout raiz en vez de inyectarse inline.
 * Motivo: un `<script>` inline exige `'unsafe-inline'` en `script-src`, y la CSP
 * con nonce (ver `src/lib/security/csp.ts`) no lo permite.
 *
 * Se usa un tag plano y no `next/script` con `beforeInteractive` porque en App
 * Router esa estrategia termina INLINE el script (verificado: 3 scripts inline
 * por pagina en lugar de 0), que es justo lo que se quiere evitar. El tag
 * plano se renderiza en el head y por lo tanto corre antes del primer paint.
 *
 * El nonce es OBLIGATORIO tambien en los scripts con `src`, no solo en los
 * inline: la CSP usa `'strict-dynamic'`, que desactiva el allowlisting por host
 * y descarta `'self'`. Sin nonce el navegador bloquea el script en silencio y
 * el tema no se aplica. Next ya pone nonce en sus propios scripts, este es
 * el unico que tenemos que firmar nosotros.
 *
 * `suppressHydrationWarning` en `<html>` sigue siendo necesario: el script
 * modifica `className` antes de que React hidrate.
 */
export async function ThemeInit() {
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  // eslint-disable-next-line @next/next/no-sync-scripts -- tag externo mismo origen: es la unica forma de evitar un script inline (CSP) y seguir ejecutando antes del paint
  return <script src="/theme-init.js" nonce={nonce} />;
}
