const ACTIVE_TENANT_KEY = 'vynko_active_tenant_id';

export async function fetchWithTenant(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let tenantId: string | null = null;
  try {
    tenantId = localStorage.getItem(ACTIVE_TENANT_KEY);
  } catch {}

  const headers = new Headers(init?.headers);
  if (tenantId) {
    headers.set('x-active-tenant-id', tenantId);
  }

  return fetch(input, { ...init, headers });
}

export function getTenantHeaders(): Record<string, string> {
  let tenantId: string | null = null;
  try {
    tenantId = localStorage.getItem(ACTIVE_TENANT_KEY);
  } catch {}
  const headers: Record<string, string> = {};
  if (tenantId) {
    headers['x-active-tenant-id'] = tenantId;
  }
  return headers;
}

/**
 * La sesion viaja en la cookie, no en un header.
 *
 * Antes se adunaba `Authorization: Bearer <access_token>` leyendo el token con
 * `supabase.auth.getSession()` desde el navegador. Eso es incompatible con una
 * cookie de sesion HttpOnly: si el navegador no puede leerla, tampoco puede
 * mandarla, y ademas dejar de hacerlo es justamente lo que impide que un XSS
 * robe la sesion. Las rutas de API resuelven al usuario desde la cookie con el
 * cliente de servidor (`supabase.auth.getUser()`), asi que el header no hace
 * falta para ninguna.
 *
 * Se mantiene el nombre exportado porque hay muchos call sites; lo que cambia
 * es que ya no intenta obtener un token.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  return getTenantHeaders();
}

export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const send = () => {
    const headers = new Headers();
    const auth = getTenantHeaders();
    for (const [key, value] of Object.entries(auth)) {
      headers.set(key, value);
    }
    for (const [key, value] of new Headers(init?.headers)) {
      headers.set(key, value);
    }
    return fetch(input, { ...init, headers, credentials: init?.credentials ?? 'include' });
  };

  const response = await send();
  if (response.status !== 401) return response;

  // Un 401 en una ruta autenticada casi siempre es un access token vencido
  // que el cliente de servidor no llegó a refrescar (por ejemplo, porque dos
  // requests paralelos compitieron por el mismo refresh token). `/api/session`
  // resuelve la sesión contra Supabase y reescribe las cookies; si sigue
  // habiendo usuario, reintentamos una vez.
  if (!canReplayRequest(input, init)) return response;
  const outcome = await refreshSessionOnce();
  if (outcome === 'expired') {
    redirectToLoginForExpiredSession();
    return response;
  }
  if (outcome === 'no-access') {
    redirectToNoAccess();
    return response;
  }

  const retried = await send();
  if (retried.status === 401) redirectToLoginForExpiredSession();
  return retried;
}

/**
 * Reintentar sólo es seguro cuando el cuerpo se puede volver a enviar. Un
 * `ReadableStream` (o un `Request` ya consumido) no se puede reproducir.
 */
function canReplayRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (typeof input !== 'string' && !(input instanceof URL)) return false;
  const body = init?.body;
  if (body == null || typeof body === 'string') return true;
  return false;
}

let sessionRefresh: Promise<SessionRefreshOutcome> | null = null;

export type SessionRefreshOutcome = 'active' | 'expired' | 'no-access';

/**
 * Traduce el payload de `/api/session` a la accion que corresponde.
 *
 * Un usuario valido con `tenants: []` NO tiene la sesion vencida: lo que no
 * tiene es acceso. Mandarlo a `/login?reason=expired` le pide que vuelva a
 * entrar y, al entrar, aterriza otra vez en el mismo 401 sin explicacion. La
 * pantalla correcta es `/no-access`, la misma a la que lo manda el guard.
 *
 * `onboarding_pending === false` es la unica senal de que el alta ya termino:
 * durante el onboarding el array vacio es normal y no hay que expulsar a nadie.
 */
export function classifySessionRefresh(data: unknown): SessionRefreshOutcome {
  if (!data || typeof data !== 'object') return 'expired';

  const payload = data as {
    user?: unknown;
    tenants?: unknown;
    onboarding_pending?: unknown;
  };

  if (!payload.user) return 'expired';

  const tenants = Array.isArray(payload.tenants) ? payload.tenants : [];
  if (tenants.length === 0 && payload.onboarding_pending === false) return 'no-access';

  return 'active';
}

/**
 * Deduplica el refresco: si varias requests reciben 401 a la vez, todas
 * esperan el mismo `/api/session` en vez de competir por el refresh token.
 */
function refreshSessionOnce(): Promise<SessionRefreshOutcome> {
  if (!sessionRefresh) {
    sessionRefresh = (async () => {
      try {
        const res = await fetch('/api/session', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) return 'expired';
        const data = (await res.json()) as unknown;
        return classifySessionRefresh(data);
      } catch {
        return 'expired';
      } finally {
        sessionRefresh = null;
      }
    })();
  }
  return sessionRefresh;
}

function redirectToLoginForExpiredSession(): void {
  redirectOnce('/login?reason=expired');
}

function redirectToNoAccess(): void {
  redirectOnce('/no-access');
}

function redirectOnce(path: string): void {
  if (typeof window === 'undefined') return;
  // En tests/jsdom no hay navegación real y `location.replace` no aplica.
  if (process.env.NODE_ENV === 'test') return;
  if (window.location.pathname === path.split('?')[0]) return;
  // `replace` y no `assign`: la pantalla con la sesión vencida no debe quedar en
  // el historial, porque volver atrás mostraría datos de una sesión que ya no existe.
  window.location.replace(path);
}
