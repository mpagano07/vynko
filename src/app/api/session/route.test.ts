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
    expect(json).toEqual({ user: null, profile: null, tenant: null, tenants: [] });
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
  });

  it('selecciona la sucursal activa del usuario', async () => {
    supabaseMock.__queue('profiles', {
      data: { id: 'user-1', full_name: 'Ana', email: 'user@tienda.com' },
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
});
