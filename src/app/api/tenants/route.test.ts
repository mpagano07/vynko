import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { POST } from './route';

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

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/tenants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/tenants', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ name: 'Sucursal 2' }));
    expect(res.status).toBe(401);
  });

  it('exige un nombre de sucursal', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('El nombre de la sucursal es requerido');
  });

  it('bloquea cuando el plan alcanzó el límite de sucursales', async () => {
    supabaseMock.__queue('tenants', {
      data: [{ subscription_plan: 'starter', subscription_status: 'active', subscription_current_period_end: null }],
    });

    const res = await POST(makeRequest({ name: 'Sucursal 2' }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('permite hasta 1 sucursal');
  });

  it('crea una sucursal heredando el plan del usuario', async () => {
    supabaseMock.__queue('tenants', {
      data: [{ subscription_plan: 'business', subscription_status: 'active', subscription_current_period_end: '2026-09-01T00:00:00.000Z' }],
    });
    supabaseMock.__queue('tenants', { data: null, error: null });
    supabaseMock.__queue('tenant_users', { data: null, error: null });
    supabaseMock.__queue('tenants', {
      data: { id: expect.any(String), name: 'Sucursal 2', subscription_plan: 'business' } as unknown as Record<string, unknown>,
    });

    const res = await POST(makeRequest({ name: 'Sucursal 2' }));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.tenant).toMatchObject({ name: 'Sucursal 2', subscription_plan: 'business' });

    const tenantInsert = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'insert'
    );
    expect(tenantInsert?.args[0]).toMatchObject({
      name: 'Sucursal 2',
      subscription_plan: 'business',
      subscription_status: 'active',
      subscription_current_period_end: '2026-09-01T00:00:00.000Z',
    });

    const tuInsert = supabaseMock.__calls.find(
      (c) => c.table === 'tenant_users' && c.method === 'insert'
    );
    expect(tuInsert?.args[0]).toMatchObject({ role: 'owner', user_id: 'user-1' });
  });

  it('crea la primera sucursal con plan starter por defecto', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce({ ...mockAuth, tenantIds: [] });

    supabaseMock.__queue('tenants', { data: null, error: null });
    supabaseMock.__queue('tenant_users', { data: null, error: null });
    supabaseMock.__queue('tenants', {
      data: { id: 't-2', name: 'Principal', subscription_plan: 'starter' } as unknown as Record<string, unknown>,
    });

    const res = await POST(makeRequest({ name: 'Principal' }));
    expect(res.status).toBe(200);

    const tenantInsert = supabaseMock.__calls.find(
      (c) => c.table === 'tenants' && c.method === 'insert'
    );
    expect(tenantInsert?.args[0]).toMatchObject({ subscription_plan: 'starter' });
  });

  it('devuelve 500 cuando falla el insert del tenant', async () => {
    supabaseMock.__queue('tenants', {
      data: [{ subscription_plan: 'business', subscription_status: 'active', subscription_current_period_end: null }],
    });
    supabaseMock.__queue('tenants', { data: null, error: { message: 'insert fail' } });

    const res = await POST(makeRequest({ name: 'Sucursal 2' }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Ocurrio un error inesperado. Intenta de nuevo.');
  });

  it('devuelve 500 cuando falla el insert del tenant_users', async () => {
    supabaseMock.__queue('tenants', {
      data: [{ subscription_plan: 'business', subscription_status: 'active', subscription_current_period_end: null }],
    });
    supabaseMock.__queue('tenants', { data: null, error: null });
    supabaseMock.__queue('tenant_users', { data: null, error: { message: 'tu fail' } });

    const res = await POST(makeRequest({ name: 'Sucursal 2' }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Ocurrio un error inesperado. Intenta de nuevo.');
  });

  it('devuelve 500 ante un body inválido', async () => {
    const req = new Request('http://localhost/api/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-valid-json',
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Error interno del servidor');
  });
});
