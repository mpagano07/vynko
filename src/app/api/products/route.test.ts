import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { createActivityLog } from '@/lib/activity-log';
import { supabaseMock } from '@/test/supabase-mock';
import { GET, POST } from './route';

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

  it('devuelve 400 cuando falla el insert del producto', async () => {
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });
    supabaseMock.__queue('products', {
      data: null,
      error: { message: 'constraint failed' },
    });

    const res = await POST(makeRequest({ name: 'Coca', price: 100 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('constraint failed');
  });

  it('borra el producto y devuelve 400 cuando falla el insert del stock', async () => {
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });
    supabaseMock.__queue('products', {
      data: [{ id: 'prod-1', name: 'Coca', sku: 'COC-1', price_cents: 10000 }],
    });
    supabaseMock.__queue('product_stock', {
      data: null,
      error: { message: 'stock error' },
    });
    supabaseMock.__queue('products', { data: null, error: null }); // delete

    const res = await POST(makeRequest({ name: 'Coca', sku: 'COC-1', price: 100, stock: 3 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('stock error');

    const del = supabaseMock.__calls.find(
      (c) => c.table === 'products' && c.method === 'delete'
    );
    expect(del).toBeDefined();
    const delEq = supabaseMock.__calls.find(
      (c) => c.table === 'products' && c.method === 'eq' && c.args[0] === 'id'
    );
    expect(delEq?.args[1]).toBe('prod-1');
    expect(createActivityLog).not.toHaveBeenCalled();
  });
});

describe('GET /api/products', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  function makeGetRequest(): Request {
    return new Request('http://localhost/api/products', { method: 'GET' });
  }

  function queueProduct() {
    supabaseMock.__queue('products', {
      data: [
        {
          id: 'p1',
          name: 'Coca',
          price_cents: 15000,
          stock_data: [
            { stock: 5, min_stock: 2, max_stock: 20, deposito: 'A', pasillo: '1', estanteria: 'x' },
          ],
        },
        {
          id: 'p2',
          name: 'Sin stock',
          price_cents: null,
          stock_data: null,
        },
      ],
    });
  }

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it('lista productos con stock/price mapeados y filtrando por tenant', async () => {
    queueProduct();

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json[0]).toMatchObject({
      id: 'p1',
      price: 150,
      stock: 5,
      min_stock: 2,
      max_stock: 20,
      deposito: 'A',
      pasillo: '1',
      estanteria: 'x',
    });
    expect(json[0].stock_data).toBeUndefined();
    // producto sin stock_data ni price_cents
    expect(json[1]).toMatchObject({ price: 0, stock: 0 });

    const stockEq = supabaseMock.__calls.find(
      (c) => c.table === 'products' && c.method === 'eq' && c.args[0] === 'product_stock.active'
    );
    expect(stockEq?.args[1]).toBe(true);
    const tenantEq = supabaseMock.__calls.find(
      (c) => c.table === 'products' && c.method === 'eq' && c.args[0] === 'product_stock.tenant_id'
    );
    expect(tenantEq?.args[1]).toBe('tenant-1');
  });

  it('no filtra por tenant cuando allTenants es true', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce({ ...mockAuth, allTenants: true });
    queueProduct();

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);

    const tenantEq = supabaseMock.__calls.find(
      (c) => c.table === 'products' && c.method === 'eq' && c.args[0] === 'product_stock.tenant_id'
    );
    expect(tenantEq).toBeUndefined();
  });

  it('devuelve 500 ante un error de base de datos', async () => {
    supabaseMock.__queue('products', { data: null, error: { message: 'db down' } });

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('db down');
  });

  it('devuelve un array vacío cuando no hay datos', async () => {
    supabaseMock.__queue('products', { data: null, error: null });

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });
});

describe('POST /api/products edge cases', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(createActivityLog).mockClear();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('asume plan starter cuando el tenant no tiene plan', async () => {
    supabaseMock.__queue('tenants', { data: null, error: null });
    supabaseMock.__queue('product_stock', { data: null, error: null, count: 0 });
    supabaseMock.__queue('products', {
      data: [{ id: 'prod-1', name: 'Agua', sku: 'AGU-1', price_cents: 500 }],
    });
    supabaseMock.__queue('product_stock', { data: null, error: null });

    const res = await POST(makeRequest({ name: 'Agua', sku: 'AGU-1', price: 5 }));
    expect(res.status).toBe(201);
    expect(createActivityLog).toHaveBeenCalled();
  });

  it('con count nulo continúa porque (count ?? 0) < límite', async () => {
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'starter' } });
    supabaseMock.__queue('product_stock', { data: null, error: null, count: null });
    supabaseMock.__queue('products', {
      data: [{ id: 'prod-2', name: 'Soda', sku: 'SOD-1', price_cents: 500 }],
    });
    supabaseMock.__queue('product_stock', { data: null, error: null });

    const res = await POST(makeRequest({ name: 'Soda', sku: 'SOD-1', price: 5 }));
    expect(res.status).toBe(201);
  });

  it('devuelve 201 con null si el insert no devuelve un producto', async () => {
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });
    supabaseMock.__queue('products', { data: null, error: null });

    const res = await POST(makeRequest({ name: 'Coca', price: 100 }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toBeNull();
    expect(createActivityLog).not.toHaveBeenCalled();
  });
});
