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
  return new Request('http://localhost/api/products/counters');
}

describe('GET /api/products/counters', () => {
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

  it('resuelve conteo y alertas en un único RPC del tenant activo', async () => {
    supabaseMock.__rpcQueue('get_product_counters', {
      data: [{ product_count: 42, alerts_configured: true }],
      error: null,
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 42, alertsConfigured: true });
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_product_counters', {
      p_tenant_ids: ['tenant-1'],
    });
    // No debe volver a pedir el catálogo ni hacer COUNT por tabla.
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('pasa todas las sucursales cuando allTenants es true', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce({
      ...mockAuth,
      allTenants: true,
      tenantIds: ['tenant-1', 'tenant-2'],
    });
    supabaseMock.__rpcQueue('get_product_counters', {
      data: [{ product_count: 10, alerts_configured: false }],
      error: null,
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 10, alertsConfigured: false });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_product_counters', {
      p_tenant_ids: ['tenant-1', 'tenant-2'],
    });
  });

  it('devuelve 500 ante un error de base de datos', async () => {
    supabaseMock.__rpcQueue('get_product_counters', {
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
