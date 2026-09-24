import { supabase } from './supabaseClient';

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

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers = getTenantHeaders();
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch {}
  return headers;
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
