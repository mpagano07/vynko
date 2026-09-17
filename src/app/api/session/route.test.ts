import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { GET } from './route';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

const user = { id: 'user-1', email: 'user@tienda.com' };

function makeRequest(token?: string, activeTenantId?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (activeTenantId) headers['x-active-tenant-id'] = activeTenantId;
  return new Request('http://localhost/api/session', { headers });
}

describe('GET /api/session', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(supabaseMock.auth.getUser).mockResolvedValue({ data: { user }, error: null });
  });

  it('devuelve sesión vacía sin token', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ user: null, profile: null, tenant: null, tenants: [], onboarding_pending: true });
  });

  it('devuelve sesión vacía con token inválido', async () => {
    vi.mocked(supabaseMock.auth.getUser).mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'invalid' },
    });
    const res = await GET(makeRequest('bad-token'));
    const json = await res.json();
    expect(json.user).toBeNull();
    expect(json.tenants).toEqual([]);
    expect(json.onboarding_pending).toBe(true);
  });

  it('selecciona la sucursal activa del usuario', async () => {
    supabaseMock.__queue('profiles', {
      data: { id: 'user-1', full_name: 'Ana', email: 'user@tienda.com', onboarding_pending: false },
    });
    supabaseMock.__queue('tenant_users', {
      data: [
        { tenant_id: 't1', role: 'owner' },
        { tenant_id: 't2', role: 'member' },
      ],
    });
    supabaseMock.__queue('tenants', {
      data: [
        { id: 't1', name: 'Central' },
        { id: 't2', name: 'Sucursal Norte' },
      ],
    });

    const res = await GET(makeRequest('token', 't2'));
    const json = await res.json();

    expect(json.tenants).toHaveLength(2);
    expect(json.tenant).toMatchObject({ id: 't2', name: 'Sucursal Norte' });
    expect(json.role).toBe('member');
    expect(json.profile).toMatchObject({ full_name: 'Ana' });
    expect(json.onboarding_pending).toBe(false);
  });

  it('baja onboarding_pending a FALSE vía self-healing si el usuario ya tiene empresa pero quedó pendiente', async () => {
    supabaseMock.__queue('profiles', {
      data: { id: 'user-1', full_name: 'Ana', email: 'user@tienda.com', onboarding_pending: true },
    });
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 't1', role: 'owner' }],
    });
    supabaseMock.__queue('tenants', {
      data: [{ id: 't1', name: 'Central' }],
    });
    supabaseMock.__queue('profiles', { data: null, error: null }); // resultado del update

    const res = await GET(makeRequest('token'));
    const json = await res.json();

    expect(json.onboarding_pending).toBe(false);
    expect(json.tenant).toMatchObject({ id: 't1' });
  });

  it('cae a la primera sucursal si la activa no es válida', async () => {
    supabaseMock.__queue('profiles', { data: null, error: null });
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 't1', role: 'owner' }] });
    supabaseMock.__queue('tenants', { data: [{ id: 't1', name: 'Central' }] });

    const res = await GET(makeRequest('token', 't999'));
    const json = await res.json();
    expect(json.tenant).toMatchObject({ id: 't1' });
    expect(json.role).toBe('owner');
  });

  it('con __all__ mantiene la primera sucursal', async () => {
    supabaseMock.__queue('profiles', { data: null, error: null });
    supabaseMock.__queue('tenant_users', {
      data: [
        { tenant_id: 't1', role: 'owner' },
        { tenant_id: 't2', role: 'member' },
      ],
    });
    supabaseMock.__queue('tenants', {
      data: [
        { id: 't1', name: 'Central' },
        { id: 't2', name: 'Norte' },
      ],
    });

    const res = await GET(makeRequest('token', '__all__'));
    const json = await res.json();
    expect(json.tenant).toMatchObject({ id: 't1' });
    expect(json.tenants).toHaveLength(2);
  });

  it('devuelve 500 cuando la verificación del token falla', async () => {
    vi.mocked(supabaseMock.auth.getUser).mockRejectedValueOnce(new Error('boom'));

    const res = await GET(makeRequest('token'));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toMatchObject({ user: null, tenants: [] });
  });
});
