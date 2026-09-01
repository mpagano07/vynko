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
  return new Request('http://localhost/api/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(url: string): Request {
  return new Request(url, { method: 'GET' });
}

describe('POST /api/sales', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(createActivityLog).mockClear();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('registra una venta y reduce el stock', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('sales', { data: { id: 'sale-1' } });
    supabaseMock.__queue('sale_items', { data: null, error: null });
    supabaseMock.__queue('stock_history', { data: null, error: null });

    const res = await POST(
      makeRequest({ items: [{ product_id: 'p1', quantity: 3 }] })
    );
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.id).toBe('sale-1');
    expect(json.items).toHaveLength(1);

    const stockUpdate = supabaseMock.__calls.filter(
      (c) => c.table === 'product_stock' && c.method === 'update'
    );
    expect(stockUpdate[0].args[0]).toMatchObject({ stock: 7 });

    const historyInsert = supabaseMock.__calls.filter(
      (c) => c.table === 'stock_history' && c.method === 'insert'
    );
    expect(historyInsert[0].args[0]).toMatchObject({
      product_id: 'p1',
      quantity: -3,
      type: 'out',
    });

    expect(createActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'created', entityType: 'sale' })
    );
  });

  it('calcula subtotal y total para varios productos', async () => {
    supabaseMock.__queue('products', {
      data: [
        { id: 'p1', name: 'Coca', price: 2, price_cents: 200 },
        { id: 'p2', name: 'Agua', price: 1.5, price_cents: 150 },
      ],
    });
    supabaseMock.__queue('product_stock', {
      data: [
        { product_id: 'p1', stock: 10 },
        { product_id: 'p2', stock: 20 },
      ],
    });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps2', stock: 20 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps2' }] });
    supabaseMock.__queue('sales', { data: { id: 'sale-2' } });
    supabaseMock.__queue('sale_items', { data: null, error: null });
    supabaseMock.__queue('stock_history', { data: null, error: null });
    supabaseMock.__queue('stock_history', { data: null, error: null });

    const res = await POST(
      makeRequest({
        items: [
          { product_id: 'p1', quantity: 2 },
          { product_id: 'p2', quantity: 3 },
        ],
      })
    );
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.items).toEqual([
      expect.objectContaining({ product_id: 'p1', quantity: 2, subtotal_cents: 400 }),
      expect.objectContaining({ product_id: 'p2', quantity: 3, subtotal_cents: 450 }),
    ]);

    const saleInsert = supabaseMock.__calls.find(
      (c) => c.table === 'sales' && c.method === 'insert'
    );
    expect(saleInsert?.args[0]).toMatchObject({ total_cents: 850, status: 'completed' });

    const stockUpdates = supabaseMock.__calls.filter(
      (c) => c.table === 'product_stock' && c.method === 'update'
    );
    expect(stockUpdates.map((u) => u.args[0])).toEqual([
      { stock: 8, updated_at: expect.any(String) },
      { stock: 17, updated_at: expect.any(String) },
    ]);
  });

  it('ignora el unit_price enviado por el cliente y usa el precio de la DB', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('sales', { data: { id: 'sale-3' } });
    supabaseMock.__queue('sale_items', { data: null, error: null });
    supabaseMock.__queue('stock_history', { data: null, error: null });

    const res = await POST(
      makeRequest({ items: [{ product_id: 'p1', quantity: 2, unit_price: 3 }] })
    );
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.items[0]).toMatchObject({ unit_price_cents: 200, subtotal_cents: 400 });

    const saleInsert = supabaseMock.__calls.find(
      (c) => c.table === 'sales' && c.method === 'insert'
    );
    expect(saleInsert?.args[0]).toMatchObject({ total_cents: 400 });
  });

  it('rechaza una venta sin items', async () => {
    const res = await POST(makeRequest({ items: [] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('La venta debe tener al menos un producto');
  });

  it('rechaza una venta de un producto inexistente', async () => {
    supabaseMock.__queue('products', { data: [] });
    supabaseMock.__queue('product_stock', { data: [] });

    const res = await POST(makeRequest({ items: [{ product_id: 'ghost', quantity: 1 }] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Producto no encontrado');
  });

  it('rechaza cuando el stock es insuficiente', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 2 }] });

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 5 }] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Stock insuficiente');
  });

  it('rechaza sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 1 }] }));
    expect(res.status).toBe(401);
  });

  it('borra la venta y devuelve 400 cuando falla el insert de sale_items', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('sales', { data: { id: 'sale-9' } });
    supabaseMock.__queue('sale_items', {
      data: null,
      error: { message: 'items fail' },
    });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 8 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 2 }] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('No se pudieron guardar los ítems de la venta');

    const del = supabaseMock.__calls.find(
      (c) => c.table === 'sales' && c.method === 'delete'
    );
    expect(del).toBeDefined();
    const delEq = supabaseMock.__calls.find(
      (c) => c.table === 'sales' && c.method === 'eq' && c.args[0] === 'id'
    );
    expect(delEq?.args[1]).toBe('sale-9');
    expect(createActivityLog).not.toHaveBeenCalled();
  });
});

describe('GET /api/sales', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('lista ventas del día', async () => {
    supabaseMock.__queue('sales', {
      data: [{ id: 's1', total_cents: 1000, created_at: '2026-08-10T12:00:00.000Z' }],
    });

    const res = await GET(makeGetRequest('http://localhost/api/sales?today=true'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].id).toBe('s1');

    const gte = supabaseMock.__calls.find((c) => c.method === 'gte');
    expect(gte?.args[0]).toBe('created_at');
  });

  it('devuelve ventas paginadas', async () => {
    supabaseMock.__queue('sales', {
      data: [{ id: 's1' }],
      count: 42,
    });

    const res = await GET(makeGetRequest('http://localhost/api/sales?page=1&limit=10'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(42);
    expect(json.page).toBe(1);
    expect(json.limit).toBe(10);

    const range = supabaseMock.__calls.find((c) => c.method === 'range');
    expect(range?.args).toEqual([0, 9]);
  });

  it('aplica el filtro de días', async () => {
    supabaseMock.__queue('sales', { data: [] });

    const res = await GET(makeGetRequest('http://localhost/api/sales?days=7'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
    expect(json.total).toBe(0);

    const gte = supabaseMock.__calls.find((c) => c.method === 'gte');
    expect(gte?.args[0]).toBe('created_at');
  });

  it('solo devuelve ventas de la sucursal activa (stock/ventas independientes)', async () => {
    supabaseMock.__queue('sales', { data: [{ id: 's1' }] });

    const res = await GET(makeGetRequest('http://localhost/api/sales'));
    expect(res.status).toBe(200);

    const tenantEq = supabaseMock.__calls.find(
      (c) => c.table === 'sales' && c.method === 'eq' && c.args[0] === 'tenant_id'
    );
    expect(tenantEq?.args[1]).toBe('tenant-1');
  });

  it('mapea customer_name y product_name de items', async () => {
    supabaseMock.__queue('sales', {
      data: [
        {
          id: 's1',
          total_cents: 1000,
          customer: { name: 'Ana' },
          items: [
            { id: 'i1', product: { name: 'Coca' } },
            { id: 'i2', product: null },
          ],
        },
      ],
    });

    const res = await GET(makeGetRequest('http://localhost/api/sales'));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json[0].customer_name).toBe('Ana');
    expect(json[0].items[0].product_name).toBe('Coca');
    expect(json[0].items[1].product_name).toBeNull();
  });
});
