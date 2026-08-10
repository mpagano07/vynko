import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { createActivityLog } from '@/lib/activity-log';
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

vi.mock('@/lib/activity-log', () => ({
  createActivityLog: vi.fn(async () => undefined),
}));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/products', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(createActivityLog).mockClear();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('crea un producto válido y su stock inicial', async () => {
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });
    supabaseMock.__queue('product_stock', { data: null, error: null });
    supabaseMock.__queue('products', {
      data: [{ id: 'prod-1', name: 'Coca', sku: 'COC-1', price_cents: 15000 }],
    });
    supabaseMock.__queue('product_stock', { data: null, error: null });

    const res = await POST(makeRequest({ name: 'Coca', sku: 'COC-1', price: 150, stock: 10 }));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.id).toBe('prod-1');
    expect(json.price).toBe(150);
    expect(json.stock).toBe(10);

    const productsInsert = supabaseMock.__calls.filter(
      (c) => c.table === 'products' && c.method === 'insert'
    );
    expect(productsInsert[0].args[0]).toMatchObject({ name: 'Coca', sku: 'COC-1', price_cents: 15000 });

    const stockInsert = supabaseMock.__calls.filter(
      (c) => c.table === 'product_stock' && c.method === 'insert'
    );
    expect(stockInsert[0].args[0]).toMatchObject({
      product_id: 'prod-1',
      tenant_id: 'tenant-1',
      stock: 10,
    });

    expect(createActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'created', entityType: 'product' })
    );
  });

  it('convierte el precio a cents correctamente', async () => {
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });
    supabaseMock.__queue('product_stock', { data: null, error: null });
    supabaseMock.__queue('products', { data: [{ id: 'prod-2', name: 'X', price_cents: 999 }] });
    supabaseMock.__queue('product_stock', { data: null, error: null });

    const res = await POST(makeRequest({ name: 'X', price: 9.99 }));
    expect(res.status).toBe(201);
    const productsInsert = supabaseMock.__calls.filter(
      (c) => c.table === 'products' && c.method === 'insert'
    );
    expect(productsInsert[0].args[0]).toMatchObject({ price_cents: 999 });
  });

  it('rechaza un producto sin nombre', async () => {
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });
    supabaseMock.__queue('product_stock', { data: null, error: null });

    const res = await POST(makeRequest({ price: 100 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('El nombre del producto es requerido');
  });

  it('rechaza un SKU inválido', async () => {
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });
    supabaseMock.__queue('product_stock', { data: null, error: null });

    const res = await POST(makeRequest({ name: 'Coca', sku: 'ab' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('El SKU debe tener al menos 3 caracteres');
  });

  it('rechaza un precio negativo', async () => {
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });
    supabaseMock.__queue('product_stock', { data: null, error: null });

    const res = await POST(makeRequest({ name: 'Coca', price: -5 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('El precio no puede ser negativo');
  });

  it('rechaza un stock negativo', async () => {
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });
    supabaseMock.__queue('product_stock', { data: null, error: null });

    const res = await POST(makeRequest({ name: 'Coca', stock: -3 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('El stock no puede ser negativo');
  });

  it('bloquea cuando el plan alcanzó el límite de productos', async () => {
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'starter' } });
    supabaseMock.__queue('product_stock', { data: null, error: null, count: 50 });

    const res = await POST(makeRequest({ name: 'Coca' }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('permite hasta 50 productos');
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ name: 'Coca' }));
    expect(res.status).toBe(401);
  });
});
