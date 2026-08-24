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

function makeRequest(params: Record<string, string>, body: unknown): Request {
  const url = `http://localhost/api/products/${params.id}/adjust`;
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const routeParams = Promise.resolve({ id: 'p1' });

describe('POST /api/products/[id]/adjust', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('ajusta stock positivamente y registra el historial', async () => {
    supabaseMock.__queue('products', { data: { id: 'p1', name: 'Coca' } });
    supabaseMock.__queue('product_stock', { data: { stock: 5 } });
    supabaseMock.__queue('product_stock', { data: null, error: null });
    supabaseMock.__queue('stock_history', { data: null, error: null });

    const res = await POST(
      makeRequest({ id: 'p1' }, { quantity: 3, reason: 'found' }),
      { params: routeParams } as never
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.previousStock).toBe(5);
    expect(json.newStock).toBe(8);
    expect(json.success).toBe(true);

    const historyInsert = supabaseMock.__calls.find(
      (c) => c.table === 'stock_history' && c.method === 'insert'
    );
    expect(historyInsert?.args[0]).toMatchObject({
      product_id: 'p1',
      quantity: 3,
      type: 'adjustment',
      reason: 'found',
    });
  });

  it('rechaza un ajuste que dejaría stock negativo', async () => {
    supabaseMock.__queue('products', { data: { id: 'p1', name: 'Coca' } });
    supabaseMock.__queue('product_stock', { data: { stock: 2 } });

    const res = await POST(
      makeRequest({ id: 'p1' }, { quantity: -10, reason: 'damaged' }),
      { params: routeParams } as never
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('El stock no puede ser negativo');
  });

  it('rechaza un producto inexistente', async () => {
    supabaseMock.__queue('products', { data: null, error: { message: 'not found' } });

    const res = await POST(
      makeRequest({ id: 'nope' }, { quantity: 1, reason: 'found' }),
      { params: Promise.resolve({ id: 'nope' }) } as never
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Producto no encontrado');
  });

  it('rechaza sin cantidad', async () => {
    const res = await POST(
      makeRequest({ id: 'p1' }, { reason: 'found' }),
      { params: routeParams } as never
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('La cantidad es requerida');
  });

  it('rechaza sin motivo', async () => {
    const res = await POST(
      makeRequest({ id: 'p1' }, { quantity: 1 }),
      { params: routeParams } as never
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('El motivo es requerido');
  });

  it('rechaza sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await POST(
      makeRequest({ id: 'p1' }, { quantity: 1, reason: 'found' }),
      { params: routeParams } as never
    );
    expect(res.status).toBe(401);
  });

  it('devuelve advertencia cuando falla el registro en stock_history', async () => {
    supabaseMock.__queue('products', { data: { id: 'p1', name: 'Coca' } });
    supabaseMock.__queue('product_stock', { data: { stock: 5 } });
    supabaseMock.__queue('product_stock', { data: null, error: null }); // update
    supabaseMock.__queue('stock_history', {
      data: null,
      error: { message: 'history insert failed' },
    });

    const res = await POST(
      makeRequest({ id: 'p1' }, { quantity: 2, reason: 'correction', notes: 'recontado' }),
      { params: routeParams } as never
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.newStock).toBe(7);
    expect(json.warning).toContain('no se pudo registrar en el historial');
    expect(json.warning).toContain('no se pudo registrar en el historial');
    expect(json.reason).toBe('correction');
    expect(json.notes).toBe('recontado');
  });

  it('parte de stock 0 cuando el producto no tiene registro de stock', async () => {
    supabaseMock.__queue('products', { data: { id: 'p1', name: 'Coca' } });
    supabaseMock.__queue('product_stock', { data: null, error: null });
    supabaseMock.__queue('product_stock', { data: null, error: null }); // update
    supabaseMock.__queue('stock_history', { data: null, error: null });

    const res = await POST(
      makeRequest({ id: 'p1' }, { quantity: 5, reason: 'found' }),
      { params: routeParams } as never
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.previousStock).toBe(0);
    expect(json.newStock).toBe(5);
  });

  it('devuelve 500 cuando falla la actualización del stock', async () => {
    supabaseMock.__queue('products', { data: { id: 'p1', name: 'Coca' } });
    supabaseMock.__queue('product_stock', { data: { stock: 5 } });
    supabaseMock.__queue('product_stock', {
      data: null,
      error: { message: 'update failed' },
    });

    const res = await POST(
      makeRequest({ id: 'p1' }, { quantity: 1, reason: 'found' }),
      { params: routeParams } as never
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Ocurrio un error inesperado. Intenta de nuevo.');
  });
});
