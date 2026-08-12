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
  return new Request('http://localhost/api/dashboard/summary', { method: 'GET' });
}

function queueSummary() {
  supabaseMock.__queue('sales', { data: [{ id: 's1' }] });
  supabaseMock.__queue('sales', { data: [{ customer_id: 'c1', total_cents: 5000 }] });
  supabaseMock.__queue('sales', { data: [{ created_at: '2026-08-01T12:00:00.000Z' }] });
  supabaseMock.__queue('purchase_orders', { data: [{ supplier_id: 'sup1' }] });
  supabaseMock.__queue('sale_items', { data: [{ product_id: 'p1', quantity: 2 }] });
  supabaseMock.__queue('products', { data: { name: 'Coca' } });
  supabaseMock.__queue('customers', { data: { name: 'Ana' } });
  supabaseMock.__queue('suppliers', { data: { name: 'Proveedor' } });
}

describe('GET /api/dashboard/summary', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('filtra por tenant para un usuario de una sola sucursal', async () => {
    queueSummary();

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.topProduct).toEqual({ name: 'Coca', qty: 2 });
    expect(json.topCustomer).toEqual({ name: 'Ana', total: 50 });
    expect(json.topSupplier).toEqual({ name: 'Proveedor' });
    expect(json.lastPurchase).toEqual({ date: '2026-08-01T12:00:00.000Z' });

    const salesEqs = supabaseMock.__calls.filter(
      (c) => c.table === 'sales' && c.method === 'eq'
    );
    expect(salesEqs.length).toBeGreaterThan(0);
    for (const call of salesEqs) {
      expect(call.args[0]).toBe('tenant_id');
      expect(call.args[1]).toBe('tenant-1');
    }
  });

  it('no filtra por tenant cuando el usuario ve todas las sucursales', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce({ ...mockAuth, allTenants: true });
    queueSummary();

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const salesEqs = supabaseMock.__calls.filter(
      (c) => c.table === 'sales' && c.method === 'eq'
    );
    expect(salesEqs).toHaveLength(0);
  });

  it('devuelve valores nulos cuando no hay datos', async () => {
    supabaseMock.__queue('sales', { data: [] });
    supabaseMock.__queue('sales', { data: [] });
    supabaseMock.__queue('sales', { data: [] });
    supabaseMock.__queue('purchase_orders', { data: [] });

    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json).toEqual({
      topProduct: null,
      topCustomer: null,
      lastPurchase: null,
      topSupplier: null,
    });
  });

  it('devuelve 500 cuando getAuth lanza una excepción', async () => {
    vi.mocked(getAuth).mockRejectedValueOnce(new Error('boom'));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('boom');
  });

  it('devuelve un mensaje genérico cuando el error no es una instancia de Error', async () => {
    vi.mocked(getAuth).mockRejectedValueOnce('string-error');
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Error processing summary');
  });

  it('usa "—" como fallback cuando el detalle del producto/cliente/proveedor no existe', async () => {
    supabaseMock.__queue('sales', { data: [{ id: 's1' }] });
    supabaseMock.__queue('sales', { data: [{ customer_id: 'c1', total_cents: 5000 }] });
    supabaseMock.__queue('sales', { data: [{ created_at: '2026-08-01T12:00:00.000Z' }] });
    supabaseMock.__queue('purchase_orders', { data: [{ supplier_id: 'sup1' }] });
    supabaseMock.__queue('sale_items', { data: [{ product_id: 'p1', quantity: 2 }] });
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('customers', { data: null, error: null });
    supabaseMock.__queue('suppliers', { data: null, error: null });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.topProduct).toEqual({ name: '—', qty: 2 });
    expect(json.topCustomer).toEqual({ name: '—', total: 50 });
    expect(json.topSupplier).toEqual({ name: '—' });
  });
});
