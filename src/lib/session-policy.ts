/**
 * Politica de sesion, compartida entre el cliente y el proxy.
 *
 * Vive en su propio modulo porque las dos puntas necesitan exactamente el mismo
 * numero. Antes el timeout de inactividad estaba escrito en `auth-context.tsx` y
 * el proxy no lo conocia: el navegador cerraba la sesion por su cuenta, pero
 * una cookie robada podia seguir renovandose desde el servidor indefinidamente.
 * Ahora el proxy aplica el mismo plazo, que es el unico que se puede esquivar
 * de verdad.
 */

export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos

/**
 * ¿La sesion vencio por inactividad?
 *
 * `lastSeenMs` es el valor de la cookie; `Number.NaN` (cookie ausente o basura)
 * cuenta como vencida a proposito: si la ausencia se tratara como "recien
 * activo", una cookie de sesion robada sin la cookie de last-seen esquivaria el
 * plazo para siempre.
 */
export function isInactivityExpired(
  lastSeenMs: number,
  nowMs: number = Date.now()
): boolean {
  return !Number.isFinite(lastSeenMs) || nowMs - lastSeenMs > INACTIVITY_TIMEOUT_MS;
}

/**
 * Cookie HttpOnly con el instante de la ultima peticion autenticada.
 *
 * El cliente no la lee ni la escribe: la mantiene el proxy. Por eso no sirve
 * `localStorage` para esto, que el usuario puede editar a voluntad.
 */
export const LAST_SEEN_COOKIE = 'vynko_last_seen';

/** El mismo origen que la sesion: raiz, HttpOnly, sin dominio. */
export const LAST_SEEN_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
} as const;
