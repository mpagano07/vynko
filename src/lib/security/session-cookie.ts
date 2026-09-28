type CookieOptions = Record<string, unknown>;

/**
 * Opciones de endurecimiento de las cookies de sesion de Supabase.
 *
 * Vive en su propio modulo, y no en `lib/supabase.ts`, por una razon concreta:
 * lo necesitan los dos caminos que escriben cookies de sesion, el cliente SSR de
 * las rutas de API y el proxy. Antes el proxy repetia la misma logica inline y
 * era facil que se quedara sin aplicarla, con lo cual una correccion en un lado
 * no tocaba al otro. Un solo lugar significa que `httpOnly` no se puede activar
 * en un camino y olvidarse del otro.
 *
 * La sesion se mantiene en cookies para que cada request de API lleve al usuario
 * sin que el JavaScript tenga que intervenir. `httpOnly` es lo que impide que un
 * XSS se la lleve, y se activa aqui, en el unico punto por donde pasan todas las
 * escrituras.
 *
 * Estado: la app ya no depende de que el JS lea la sesion. `AuthProvider`
 * resuelve el usuario contra `/api/session` y `getAuthHeaders()` no manda header
 * Authorization, de modo que marcar `httpOnly: true` no obliga a cambiar ningun
 * call site.
 *
 * Resto de medidas: SameSite=Lax, Secure en produccion, y cookies de sesion sin
 * maxAge/expires para que mueran al cerrar el navegador.
 */
export function hardenSessionCookieOptions(options: CookieOptions): CookieOptions {
  return {
    ...options,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: (options.path as string) ?? '/',
    // La sesion queda cerrada al JavaScript. Un XSS ya no puede leer el token:
    // no esta en `document.cookie` ni en ningun header que la app construya.
    // El navegador la manda solo, y el servidor la resuelve con `getUser()`.
    httpOnly: true,
  };
}
