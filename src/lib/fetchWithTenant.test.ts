import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTenant, getTenantHeaders } from './fetchWithTenant';

const { getAuthHeaders, authFetch, classifySessionRefresh } = await import('./fetchWithTenant');

describe('fetchWithTenant', () => {
  beforeEach(() => {
    // Clear localStorage
    localStorage.clear();
    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue(new Response('ok'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchWithTenant', () => {
    it('does not add header when there is no active tenant', async () => {
      await fetchWithTenant('http://api/test');
      
      expect(global.fetch).toHaveBeenCalledWith(
        'http://api/test',
        expect.objectContaining({
          headers: expect.any(Headers),
        })
      );
      
      const callArgs = vi.mocked(global.fetch).mock.calls[0];
      const headers = callArgs[1]?.headers as Headers;
      expect(headers.get('x-active-tenant-id')).toBeNull();
    });

    it('adds x-active-tenant-id header when active tenant exists', async () => {
      localStorage.setItem('vynko_active_tenant_id', 'tenant-123');
      
      await fetchWithTenant('http://api/test');
      
      expect(global.fetch).toHaveBeenCalled();
      const callArgs = vi.mocked(global.fetch).mock.calls[0];
      const headers = callArgs[1]?.headers as Headers;
      expect(headers.get('x-active-tenant-id')).toBe('tenant-123');
    });

    it('preserves other init options like method and body', async () => {
      localStorage.setItem('vynko_active_tenant_id', 'tenant-123');
      
      const customInit = {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
        headers: {
          'Content-Type': 'application/json',
        }
      };
      
      await fetchWithTenant('http://api/test', customInit);
      
      const callArgs = vi.mocked(global.fetch).mock.calls[0];
      expect(callArgs[1]?.method).toBe('POST');
      expect(callArgs[1]?.body).toBe(customInit.body);
      
      const headers = callArgs[1]?.headers as Headers;
      expect(headers.get('x-active-tenant-id')).toBe('tenant-123');
      expect(headers.get('Content-Type')).toBe('application/json');
    });
  });

  describe('getTenantHeaders', () => {
    it('returns empty object when no tenant is active', () => {
      const headers = getTenantHeaders();
      expect(headers).toEqual({});
    });

    it('returns object with x-active-tenant-id when tenant is active', () => {
      localStorage.setItem('vynko_active_tenant_id', 'tenant-456');
      const headers = getTenantHeaders();
      expect(headers).toEqual({ 'x-active-tenant-id': 'tenant-456' });
    });
    
    it('handles localStorage errors gracefully (e.g. cookies disabled)', () => {
      // Mock localStorage to throw error
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = () => { throw new Error('Access Denied'); };
      
      const headers = getTenantHeaders();
      expect(headers).toEqual({});
      
      // Restore
      localStorage.getItem = originalGetItem;
    });
  });
});

describe('getAuthHeaders', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns only the tenant header, never an Authorization header', async () => {
    localStorage.setItem('vynko_active_tenant_id', 'tenant-123');
    const headers = await getAuthHeaders();
    expect(headers).toEqual({ 'x-active-tenant-id': 'tenant-123' });
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('returns an empty object when no tenant is active', async () => {
    expect(await getAuthHeaders()).toEqual({});
  });
});

describe('authFetch', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn().mockResolvedValue(new Response('ok'));
  });

  it('merges tenant and caller headers, and never sends Authorization', async () => {
    localStorage.setItem('vynko_active_tenant_id', 'tenant-123');

    await authFetch('http://api/test', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://api/test',
      expect.objectContaining({ method: 'POST', body: '{}' })
    );
    const callArgs = vi.mocked(global.fetch).mock.calls[0];
    const headers = callArgs[1]?.headers as Headers;
    // La sesion viaja en la cookie HttpOnly. Si un header Authorization se
    // colara, seria la sesion expuesta al JS que se esta intentando cerrar.
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('x-active-tenant-id')).toBe('tenant-123');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('preserves an explicit Authorization header set by the caller', async () => {
    await authFetch('http://api/test', {
      headers: { Authorization: 'Bearer explicito' },
    });

    const callArgs = vi.mocked(global.fetch).mock.calls[0];
    const headers = callArgs[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer explicito');
  });

  it('calls fetch even without a tenant', async () => {
    await authFetch('http://api/test');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes the session and retries once after a 401', async () => {
    // Un access token vencido no debe mostrar un error al usuario: `/api/session`
    // reescribe las cookies y la request original se puede repetir.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: 'user-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    global.fetch = fetchMock;

    const response = await authFetch('/api/settings/collaborators', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/session');
    expect(fetchMock.mock.calls[2][0]).toBe('/api/settings/collaborators');
    const retriedInit = fetchMock.mock.calls[2][1] as RequestInit;
    expect(retriedInit.body).toBe('{}');
    expect((retriedInit.headers as Headers).get('Content-Type')).toBe('application/json');
  });

  it('does not retry when refreshing the session returns no user', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    global.fetch = fetchMock;

    const response = await authFetch('/api/settings/collaborators');

    expect(response.status).toBe(401);
    // No se repite la request original: sin usuario no hay nada que reintentar.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('no reintenta ni trata como vencida la sesión de un usuario sin membresías', async () => {
    // Un usuario válido al que le desactivaron la última membresía recibe 401
    // en las rutas de datos. No es una sesión vencida: /no-access explica lo
    // que pasa; /login?reason=expired lo haría entrar en un bucle.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: { id: 'user-1' },
            tenants: [],
            onboarding_pending: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    global.fetch = fetchMock;

    const response = await authFetch('/api/settings/collaborators');

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a body that cannot be replayed', async () => {
    // FormData/streams consumen el cuerpo: reenviarlo mandaría una request
    // distinta o vacía. Es preferible devolver el 401 tal cual.
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 }));
    global.fetch = fetchMock;

    const body = new FormData();
    body.append('file', 'contenido');
    const response = await authFetch('/api/upload', { method: 'POST', body });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('classifySessionRefresh', () => {
  it('trata como vencida la sesión sin usuario', () => {
    expect(classifySessionRefresh({ user: null })).toBe('expired');
    expect(classifySessionRefresh(null)).toBe('expired');
  });

  it('trata como sin acceso al usuario con onboarding completo y cero membresías', () => {
    expect(
      classifySessionRefresh({
        user: { id: 'user-1' },
        tenants: [],
        onboarding_pending: false,
      })
    ).toBe('no-access');
  });

  it('mantiene la sesión activa si todavía está en onboarding', () => {
    expect(
      classifySessionRefresh({
        user: { id: 'user-1' },
        tenants: [],
        onboarding_pending: true,
      })
    ).toBe('active');
  });

  it('mantiene la sesión activa si tiene al menos una membresía', () => {
    expect(
      classifySessionRefresh({
        user: { id: 'user-1' },
        tenants: [{ id: 'tenant-1' }],
        onboarding_pending: false,
      })
    ).toBe('active');
  });
});
