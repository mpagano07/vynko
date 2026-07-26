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
