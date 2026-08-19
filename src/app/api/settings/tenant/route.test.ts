import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { PATCH } from './route';

const mockAuth = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  allTenants: false,
  tenantIds: ['tenant-1'],
};

vi.mock('@/lib/api-auth', () => ({
  getAuth: vi.fn(async () => mockAuth),
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

function makePatchRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/settings/tenant', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/settings/tenant', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await PATCH(makePatchRequest({ name: 'Nuevo nombre' }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Not authenticated');
  });

  it('devuelve 403 para member', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ role: 'member' }],
    });

    const res = await PATCH(makePatchRequest({ name: 'Nuevo nombre' }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('Only the owner');
  });

  it('devuelve 403 para manager', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ role: 'manager' }],
    });

    const res = await PATCH(makePatchRequest({ name: 'Nuevo nombre' }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('Only the owner');
  });

  it('devuelve 200 para owner y actualiza settings', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ role: 'owner' }],
    });
    supabaseMock.__queue('tenants', {
      data: { id: 'tenant-1', name: 'Nuevo nombre' },
    });

    const res = await PATCH(makePatchRequest({ name: 'Nuevo nombre' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tenant).toMatchObject({ id: 'tenant-1', name: 'Nuevo nombre' });

    const updateCall = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'update'
    );
    expect(updateCall).toBeDefined();
  });

  it('devuelve 404 si el tenant no existe', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [],
    });

    const res = await PATCH(makePatchRequest({ name: 'Test' }));
    expect(res.status).toBe(404);
  });

  it('devuelve 400 para nombre vacío', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ role: 'owner' }],
    });

    const res = await PATCH(makePatchRequest({ name: '   ' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid name');
  });
});
