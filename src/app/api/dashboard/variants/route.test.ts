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
  return new Request('http://localhost/api/dashboard/variants', { method: 'GET' });
}

describe('GET /api/dashboard/variants', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('devuelve los críticos de variante con nombre compuesto', async () => {
    supabaseMock.__rpcQueue('get_critical_variants', {
      data: [
        {
          id: 'v1',
          product_id: 'p1',
          name: 'Remera',
          label: 'Rojo / M',
          sku: 'REM-ROJ-M',
          stock: 1,
          min_stock: 5,
        },
      ],
      error: null,
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      expect.objectContaining({
        id: 'v1',
        display_name: 'Remera · Rojo / M',
        stock: 1,
        min_stock: 5,
      }),
    ]);

  });

  it('devuelve 500 cuando la RPC falla', async () => {
    supabaseMock.__rpcQueue('get_critical_variants', {
      data: null,
      error: { message: 'boom' },
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' });
  });
});
