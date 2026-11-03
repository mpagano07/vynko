import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { GET } from './route';

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

function makeRequest(): Request {
  return new Request('http://localhost/api/products/critical');
}

describe('GET /api/products/critical', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('devuelve solo lo que trae la RPC, sin consultar el catálogo completo', async () => {
    supabaseMock.__rpcQueue('get_critical_products', {
      data: [
        { id: 'prod-1', name: 'Harina', stock: 2, min_stock: 5 },
        { id: 'prod-2', name: 'Azúcar', stock: 0, min_stock: 0 },
      ],
      error: null,
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: 'prod-1', name: 'Harina', stock: 2, min_stock: 5 },
      { id: 'prod-2', name: 'Azúcar', stock: 0, min_stock: 0 },
    ]);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_critical_products', {
      p_tenant_ids: ['tenant-1'],
    });
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('pasa todas las sucursales cuando allTenants es true', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce({
      ...mockAuth,
      allTenants: true,
      tenantIds: ['tenant-1', 'tenant-2'],
    });
    supabaseMock.__rpcQueue('get_critical_products', { data: [], error: null });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_critical_products', {
      p_tenant_ids: ['tenant-1', 'tenant-2'],
    });
  });

  it('devuelve 500 ante un error de base de datos', async () => {
    supabaseMock.__rpcQueue('get_critical_products', {
      data: null,
      error: { message: 'db down' },
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Ocurrio un error inesperado. Intenta de nuevo.',
    });
  });
});
