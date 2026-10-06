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

  it('ajusta stock positivamente y registra el historial en la misma RPC', async () => {
    supabaseMock.__queue('products', { data: { id: 'p1', name: 'Coca' } });
    supabaseMock.__queue('product_stock', { data: { stock: 5 } });

    const res = await POST(
      makeRequest({ id: 'p1' }, { quantity: 3, reason: 'found' }),
      { params: routeParams } as never
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.previousStock).toBe(5);
    expect(json.newStock).toBe(8);
    expect(json.success).toBe(true);

    // El ajuste, el chequeo de no-negativo y el movimiento viajan en una sola
    // llamada a `adjust_stock_atomic` (049): ya no hay un UPDATE separado ni
    // un INSERT de historial que pueda faltar.
    expect(supabaseMock.rpc).toHaveBeenCalledWith('adjust_stock_atomic', {
      p_product_id: 'p1',
      p_tenant_id: 'tenant-1',
      p_quantity: 3,
      p_reason: 'found',
      p_created_by: 'user-1',
    });
    expect(
      supabaseMock.__calls.some((c) => c.table === 'stock_history' && c.method === 'insert')
    ).toBe(false);
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

  it('escribe las notas del ajuste en el motivo del movimiento', async () => {
    supabaseMock.__queue('products', { data: { id: 'p1', name: 'Coca' } });
    supabaseMock.__queue('product_stock', { data: { stock: 5 } });

    const res = await POST(
      makeRequest({ id: 'p1' }, { quantity: 2, reason: 'correction', notes: 'recontado' }),
      { params: routeParams } as never
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.newStock).toBe(8);
    // Como el movimiento lo escribe la RPC en la misma transaccion, ya no hay
    // warning posible: el stock y su registro cambian juntos o no cambian.
    expect(json.warning).toBeUndefined();
    expect(json.reason).toBe('correction');
    expect(json.notes).toBe('recontado');

    expect(supabaseMock.rpc).toHaveBeenCalledWith('adjust_stock_atomic', {
      p_product_id: 'p1',
      p_tenant_id: 'tenant-1',
      p_quantity: 2,
      p_reason: 'correction: recontado',
      p_created_by: 'user-1',
    });
  });

  it('rechaza en la RPC un ajuste que otra venta dejó sin alcanzar', async () => {
    // El fail-fast leyó stock suficiente, pero otro ajuste concurrente movió la
    // fila y el chequeo atomico (que ve el valor REAL del momento) ya no
    // alcanza. El caso que el UPDATE condicional de la funcion cubre.
    supabaseMock.__queue('products', { data: { id: 'p1', name: 'Coca' } });
    supabaseMock.__queue('product_stock', { data: { stock: 5 } });
    supabaseMock.__rpcResults.adjust_stock_atomic = {
      data: [{ ok: false, old_stock: 1, new_stock: null }],
      error: null,
    };

    const res = await POST(
      makeRequest({ id: 'p1' }, { quantity: -4, reason: 'damaged' }),
      { params: routeParams } as never
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('El stock no puede ser negativo');
    expect(
      supabaseMock.__calls.some((c) => c.table === 'stock_history' && c.method === 'insert')
    ).toBe(false);
  });

  it('devuelve 404 cuando el producto no tiene stock en la sucursal', async () => {
    supabaseMock.__queue('products', { data: { id: 'p1', name: 'Coca' } });
    supabaseMock.__queue('product_stock', { data: null, error: null });

    const res = await POST(
      makeRequest({ id: 'p1' }, { quantity: 5, reason: 'found' }),
      { params: routeParams } as never
    );
    expect(res.status).toBe(404);

    // Sin registro de stock no debe quedar ningún movimiento en el historial.
    const historyInserts = supabaseMock.__calls.filter(
      (c) => c.table === 'stock_history' && c.method === 'insert'
    );
    expect(historyInserts).toHaveLength(0);
  });

  it('devuelve 500 cuando falla la actualización del stock', async () => {
    supabaseMock.__queue('products', { data: { id: 'p1', name: 'Coca' } });
    supabaseMock.__queue('product_stock', { data: { stock: 5 } });
    supabaseMock.__rpcResults.adjust_stock_atomic = {
      data: null,
      error: { message: 'update failed' },
    };

    const res = await POST(
      makeRequest({ id: 'p1' }, { quantity: 1, reason: 'found' }),
      { params: routeParams } as never
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Ocurrio un error inesperado. Intenta de nuevo.');
  });

  it('devuelve 404 cuando la RPC no encuentra la fila del tenant', async () => {
    supabaseMock.__queue('products', { data: { id: 'p1', name: 'Coca' } });
    supabaseMock.__queue('product_stock', { data: { stock: 5 } });
    // La fila de stock se borro entre el fail-fast y la RPC (eliminacion del
    // producto): `old_stock` NULL es la senal de "no hay fila".
    supabaseMock.__rpcResults.adjust_stock_atomic = {
      data: [{ ok: false, old_stock: null, new_stock: null }],
      error: null,
    };

    const res = await POST(
      makeRequest({ id: 'p1' }, { quantity: 1, reason: 'found' }),
      { params: routeParams } as never
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Producto no encontrado en tu sucursal');
  });
});
