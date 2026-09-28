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
  const headers = new Headers();
  const auth = await getAuthHeaders();
  for (const [key, value] of Object.entries(auth)) {
    headers.set(key, value);
  }
  for (const [key, value] of new Headers(init?.headers)) {
    headers.set(key, value);
  }
  return fetch(input, { ...init, headers });
}
