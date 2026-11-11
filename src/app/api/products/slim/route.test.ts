import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { callsTo } from '@/test/tenant-isolation';
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
  return new Request('http://localhost/api/products/slim');
}

const slimRows = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => ({
    id: `p-${offset + i}`,
    name: `Producto ${offset + i}`,
    sku: `SKU-${offset + i}`,
    barcode: null,
  }));

describe('GET /api/products/slim', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('devuelve el catálogo del tenant activo paginado y sin más columnas que las del picker', async () => {
    supabaseMock.__queue('products', { data: slimRows(1000), error: null });
    supabaseMock.__queue('products', { data: slimRows(37, 1000), error: null });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1037);
    // Sólo los cuatro campos que usa el selector: nada de descripción,
    // imágenes ni join de stock en el payload.
    expect(json[0]).toEqual({ id: 'p-0', name: 'Producto 0', sku: 'SKU-0', barcode: null });
    expect(json[1036]).toEqual({ id: 'p-1036', name: 'Producto 1036', sku: 'SKU-1036', barcode: null });

    // Mismo scoping que listProducts: el tenant activo y el stock activo.
    const eqs = callsTo(supabaseMock.__calls, 'products', 'eq').map((call) => call.args);
    expect(eqs).toContainEqual(['product_stock.tenant_id', 'tenant-1']);
    expect(eqs).toContainEqual(['product_stock.active', true]);

    // Recorrió el tope de PostgREST por rangos.
    const ranges = callsTo(supabaseMock.__calls, 'products', 'range').map((call) => call.args);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);

    // Sin firma de imágenes: el slim no arrastra storage.
    expect(supabaseMock.__storageCalls).toHaveLength(0);
  });

  it('devuelve 500 ante un error de base de datos', async () => {
    supabaseMock.__queue('products', { data: null, error: { message: 'db down' } });

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Ocurrio un error inesperado. Intenta de nuevo.');
  });
});
