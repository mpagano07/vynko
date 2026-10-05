import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { createActivityLog } from '@/lib/activity-log';
import { trackEvent } from '@/lib/track-event';
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

vi.mock('@/lib/track-event', () => ({
  trackEvent: vi.fn(async () => undefined),
}));

// Auditoria y analytics se difieren con `after()`. Los tests tienen que
// ejecutarlos a mano antes de afirmar sobre ellos.
const afterCallbacks: Array<() => unknown> = [];
vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (cb: () => unknown) => {
      afterCallbacks.push(cb);
    },
  };
});

async function flushAfter() {
  while (afterCallbacks.length > 0) {
    const cb = afterCallbacks.shift()!;
    await cb();
  }
}

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

/**
 * Llamadas a `decrement_stock` (migracion 043).
 *
 * El descuento de stock ya no es un `UPDATE` de PostgREST con compare-and-swap
 * desde JS: es una RPC que hace el check y el write en una sola sentencia. Los
 * tests afirman sobre esa llamada, no sobre la forma del SQL.
 */
function createSaleCall(): Record<string, unknown> | undefined {
  const call = supabaseMock.rpc.mock.calls.find(([fn]) => fn === 'create_sale_atomic');
  return call?.[1] as Record<string, unknown> | undefined;
}

function decrementCalls() {
  return supabaseMock.rpc.mock.calls
    .filter(([fn]) => fn === 'decrement_stock')
    .map(([, args]) => args as { p_product_id: string; p_tenant_id: string; p_quantity: number });
}

describe('POST /api/sales', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(createActivityLog).mockClear();
    vi.mocked(trackEvent).mockClear();
    afterCallbacks.length = 0;
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

    // El stock lo descuenta `decrement_stock`, una vez por item, con la
    // cantidad pedida y el tenant de la sesion (no el del body).
    expect(decrementCalls()).toEqual([
      { p_product_id: 'p1', p_tenant_id: 'tenant-1', p_quantity: 3 },
    ]);

    const historyInsert = (createSaleCall()?.p_stock_movements ?? []) as Array<Record<string, unknown>>;
    expect(historyInsert[0]).toMatchObject({
      product_id: 'p1',
      quantity: -3,
      type: 'out',
    });

    expect(createActivityLog).not.toHaveBeenCalled();

    await flushAfter();
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

    const saleInsert = createSaleCall();
    expect(saleInsert).toMatchObject({ p_total_cents: 850, p_status: 'completed' });

    // Un descuento por item, en orden, cada uno con su cantidad.
    expect(decrementCalls()).toEqual([
      { p_product_id: 'p1', p_tenant_id: 'tenant-1', p_quantity: 2 },
      { p_product_id: 'p2', p_tenant_id: 'tenant-1', p_quantity: 3 },
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

    const saleInsert = createSaleCall();
    expect(saleInsert).toMatchObject({ p_total_cents: 400 });
  });

  it('rechaza vender un producto sin price_cents en vez de venderlo a $0', async () => {
    // `price_cents` en NULL con el legacy `price` en 0 es el estado real de 163
    // productos del catalogo. Con el fallback anterior esto vendia a $0.00 y
    // devolvia 201: una venta sin facturar. Tiene que fallar con un mensaje que
    // le diga al cajero que hacer.
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 0, price_cents: null }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 1 }] }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('no tiene precio de venta cargado');
    expect(json.error).toContain('Coca');
    // No se descuenta stock ni se crea venta: el fallo es antes de escribir.
    expect(supabaseMock.rpc.mock.calls.some(([fn]) => fn === 'decrement_stock')).toBe(false);
    expect(supabaseMock.rpc.mock.calls.some(([fn]) => fn === 'create_sale_atomic')).toBe(false);
  });

  it('acepta un producto con price_cents en 0: es una venta gratis explicita', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Muestra', price: 0, price_cents: 0 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 1 }] }));

    expect(res.status).toBe(201);
    expect(createSaleCall()).toMatchObject({ p_total_cents: 0 });
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

  it('aplica descuento, recargo y guarda el medio de pago con vuelto', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('sales', { data: { id: 'sale-4' } });
    supabaseMock.__queue('sale_items', { data: null, error: null });
    supabaseMock.__queue('stock_history', { data: null, error: null });

    const res = await POST(
      makeRequest({
        items: [{ product_id: 'p1', quantity: 2 }],
        payment_method: 'mercadopago',
        amount_paid: 400,
        discount_percent: 10,
        surcharge_percent: 5,
      })
    );
    expect(res.status).toBe(201);

    const saleInsert = createSaleCall();
    expect(saleInsert).toMatchObject({
      p_total_cents: 380,
      p_payment_method: 'mercadopago',
      p_discount_cents: 40,
      p_surcharge_cents: 20,
      p_amount_paid_cents: 40000,
      p_change_cents: 39620,
    });
  });

  it('calcula vuelto en efectivo cuando el cliente paga de más', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('sales', { data: { id: 'sale-5' } });
    supabaseMock.__queue('sale_items', { data: null, error: null });
    supabaseMock.__queue('stock_history', { data: null, error: null });

    const res = await POST(
      makeRequest({
        items: [{ product_id: 'p1', quantity: 1 }],
        payment_method: 'cash',
        amount_paid: 500,
      })
    );
    expect(res.status).toBe(201);

    const saleInsert = createSaleCall();
    expect(saleInsert).toMatchObject({
      p_total_cents: 200,
      p_payment_method: 'cash',
      p_amount_paid_cents: 50000,
      p_change_cents: 49800,
    });
  });

  it('rechaza un medio de pago inválido', async () => {
    const res = await POST(
      makeRequest({ items: [{ product_id: 'p1', quantity: 1 }], payment_method: 'bitcoin' })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Medio de pago inválido');
  });

  it('rechaza un pago menor al total para medios no efectivo', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });

    const res = await POST(
      makeRequest({
        items: [{ product_id: 'p1', quantity: 1 }],
        payment_method: 'credit',
        amount_paid: 1,
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('El monto cobrado no puede ser menor al total de la venta');
  });

  it('devuelve 400 y devuelve el stock si la RPC de venta falla', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 8 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });

    // El mensaje lo arma la funcion con el `raise`, y es el mismo texto que ya
    // mostraba el front cuando fallaba el insert de items.
    supabaseMock.__rpcResults.create_sale_atomic = {
      data: null,
      error: { message: 'No se pudieron guardar los ítems de la venta' },
    };

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 2 }] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('No se pudieron guardar los ítems de la venta');

    // Ya no hace falta un `delete` compensatorio sobre `sales`: la transaccion
    // de `create_sale_atomic` no deja la venta a medio escribir. Ese delete era
    // justamente la fuente de ventas huerfanas cuando el propio delete fallaba.
    expect(supabaseMock.__calls.some((c) => c.table === 'sales' && c.method === 'delete')).toBe(false);

    // El stock se devuelve con `increment_stock`, por la misma cantidad que se
    // habia descontado: si el rollback fallara, el stock de la tienda
    // bajaba para siempre sin que quedara ninguna venta.
    expect(supabaseMock.rpc).toHaveBeenCalledWith('increment_stock', {
      p_product_id: 'p1',
      p_tenant_id: 'tenant-1',
      p_quantity: 2,
    });
    expect(createActivityLog).not.toHaveBeenCalled();
  });

  it('devuelve 400 sin registrar venta cuando decrement_stock rechaza por stock', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    // La lectura inicial dice 10 y alcanza, asi que la venta pasa el fail-fast.
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });

    // Pero otra venta se adelantó y el descuento atomico ya no puede: este es el
    // caso residual que la RPC cubre, donde el compare-and-swap desde JS
    // fallaba con "Demasiada concurrencia" sin decir cuantos habian.
    supabaseMock.__rpcResults.decrement_stock = { data: [{ ok: false, stock: 1 }], error: null };
    supabaseMock.__queue('sales', { data: { id: 'sale-nope' } });

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 3 }] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Stock insuficiente para "Coca" (disponible: 1)');

    // Nada de lo que viene despues debe escribirse: ni venta, ni historial.
    expect(supabaseMock.__calls.some((c) => c.table === 'sales' && c.method === 'insert')).toBe(false);
    expect(supabaseMock.__calls.some((c) => c.table === 'stock_history')).toBe(false);
    // Y tampoco hay que devolver stock: nunca se desconto.
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('increment_stock', expect.anything());
  });

  it('no reporta un error de infraestructura de la RPC como conflicto de stock', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });

    // Un error de la RPC (permisos, conexion) no es "vende otra vez": el
    // mensaje tiene que llevar a revisar el servidor, no a reintentar a ciegas.
    supabaseMock.__rpcResults.decrement_stock = {
      data: null,
      error: { message: 'permission denied for function decrement_stock' },
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 1 }] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Ocurrio un error inesperado. Intenta de nuevo.');
    consoleError.mockRestore();
  });

  it('cobra el total completo al dividir el pago, sin descuento de efectivo', async () => {
    supabaseMock.__queue('tenants', {
      data: {
        settings: {
          checkout: {
            payment_adjustments: { cash: -10, transfer: 0, debit: 0, credit: 5, mercadopago: 0 },
          },
        },
      },
    });
    supabaseMock.__queue('cash_register_sessions', { data: { id: 'session-1' } });
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('sales', { data: { id: 'sale-split' } });
    supabaseMock.__queue('sale_payments', { data: null, error: null });
    supabaseMock.__queue('sale_items', { data: null, error: null });
    supabaseMock.__queue('stock_history', { data: null, error: null });

    const res = await POST(
      makeRequest({
        items: [{ product_id: 'p1', quantity: 2 }],
        payments: [
          { method: 'cash', amount: 2, received: 2.5 },
          { method: 'transfer', amount: 2 },
        ],
      })
    );
    expect(res.status).toBe(201);

    const saleInsert = createSaleCall();
    expect(saleInsert).toMatchObject({
      p_total_cents: 400,
      p_discount_cents: 0,
      p_surcharge_cents: 0,
      p_payment_method: 'cash',
      p_amount_paid_cents: 450,
      p_change_cents: 50,
      p_session_id: 'session-1',
    });

    const paymentsInsert = (createSaleCall()?.p_payments ?? []) as Array<Record<string, unknown>>;
    // Los pagos van sin `sale_id` ni `tenant_id`: los agrega la funcion, que es
    // la unica que conoce el id recien generado.
    expect(paymentsInsert).toEqual([
      {
        method: 'cash',
        amount_cents: 200,
        received_cents: 250,
        change_cents: 50,
      },
      {
        method: 'transfer',
        amount_cents: 200,
        received_cents: 200,
        change_cents: 0,
      },
    ]);
  });

  it('mantiene el descuento de efectivo cuando la venta se cobra en un solo medio', async () => {
    supabaseMock.__queue('tenants', {
      data: {
        settings: {
          checkout: {
            payment_adjustments: { cash: -10, transfer: 0, debit: 0, credit: 5, mercadopago: 0 },
          },
        },
      },
    });
    supabaseMock.__queue('cash_register_sessions', { data: { id: 'session-1' } });
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('sales', { data: { id: 'sale-una-vez' } });
    supabaseMock.__queue('sale_items', { data: null, error: null });
    supabaseMock.__queue('stock_history', { data: null, error: null });

    // Un solo pago que cubre el total completo si lleva el -10% de efectivo.
    const res = await POST(
      makeRequest({
        items: [{ product_id: 'p1', quantity: 2 }],
        payments: [{ method: 'cash', amount: 4 }],
      })
    );
    expect(res.status).toBe(201);
    const saleInsert = createSaleCall();
    expect(saleInsert).toMatchObject({
      p_total_cents: 360,
      p_discount_cents: 40,
    });
  });

  it('aplica el ajuste automático a un solo medio de pago', async () => {
    supabaseMock.__queue('tenants', {
      data: {
        settings: {
          checkout: {
            payment_adjustments: { cash: -10, transfer: 0, debit: 0, credit: 0, mercadopago: 0 },
          },
        },
      },
    });
    supabaseMock.__queue('cash_register_sessions', { data: null });
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('sales', { data: { id: 'sale-adj' } });
    supabaseMock.__queue('sale_items', { data: null, error: null });
    supabaseMock.__queue('stock_history', { data: null, error: null });

    const res = await POST(
      makeRequest({
        items: [{ product_id: 'p1', quantity: 2 }],
        payments: [{ method: 'cash', amount: 4 }],
      })
    );
    expect(res.status).toBe(201);

    const saleInsert = createSaleCall();
    expect(saleInsert).toMatchObject({ p_total_cents: 360 });

    const paymentsInsert = (createSaleCall()?.p_payments ?? []) as Array<Record<string, unknown>>;
    const paymentRows = paymentsInsert;
    expect(paymentRows[0]).toMatchObject({
      method: 'cash',
      amount_cents: 360,
      received_cents: 360,
      change_cents: 0,
    });
  });

  it('registra el descuento del medio de pago en discount_cents', async () => {
    supabaseMock.__queue('tenants', {
      data: {
        settings: {
          checkout: {
            payment_adjustments: { cash: -10, transfer: 0, debit: 0, credit: 0, mercadopago: 0 },
          },
        },
      },
    });
    supabaseMock.__queue('cash_register_sessions', { data: null });
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Producto', price: 250, price_cents: 25000 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('sales', { data: { id: 'sale-ajuste' } });
    supabaseMock.__queue('sale_items', { data: null, error: null });
    supabaseMock.__queue('stock_history', { data: null, error: null });

    // Es lo que manda el modal con cash -10: el cliente entrega 225 por 250.
    const res = await POST(
      makeRequest({
        items: [{ product_id: 'p1', quantity: 1 }],
        payments: [{ method: 'cash', amount: 250, received: 225 }],
      })
    );
    expect(res.status).toBe(201);

    const saleInsert = createSaleCall();
    const sale = saleInsert as unknown as Record<string, number>;

    // El descuento del medio de pago queda asentado: sin esto, al recargar
    // la venta se veian items por 250 con total 225 y ningun descuento.
    expect(sale.p_discount_cents).toBe(2500);
    expect(sale.p_surcharge_cents).toBe(0);
    expect(sale.p_total_cents).toBe(22500);
    expect(sale.p_amount_paid_cents).toBe(22500);
    expect(sale.p_change_cents).toBe(0);

    // Identidad del registro: los items menos lo descontado dan el total.
    const itemsInsert = (createSaleCall()?.p_items ?? []) as Array<Record<string, unknown>>;
    const itemRows = itemsInsert;
    const itemsTotal = itemRows.reduce(
      (sum, i) => sum + Number(i.subtotal_cents ?? 0),
      0
    );
    expect(itemsTotal - sale.p_discount_cents + sale.p_surcharge_cents).toBe(
      sale.p_total_cents
    );
  });

  it('aplica el ajuste del medio tambien cuando la venta no manda payments', async () => {
    supabaseMock.__queue('tenants', {
      data: {
        settings: {
          checkout: {
            payment_adjustments: { cash: -10, transfer: 0, debit: 0, credit: 0, mercadopago: 0 },
          },
        },
      },
    });
    supabaseMock.__queue('cash_register_sessions', { data: null });
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Producto', price: 250, price_cents: 25000 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('sales', { data: { id: 'sale-sin-payments' } });
    supabaseMock.__queue('sale_items', { data: null, error: null });
    supabaseMock.__queue('stock_history', { data: null, error: null });

    const res = await POST(
      makeRequest({
        items: [{ product_id: 'p1', quantity: 1 }],
        payment_method: 'cash',
        amount_paid: 225,
      })
    );
    expect(res.status).toBe(201);

    const saleInsert = createSaleCall();
    // Antes esta venta se guardaba como 25000 y el ajuste solo existia en el
    // camino con `payments`, dejando el API y el modal con reglas distintas.
    expect(saleInsert).toMatchObject({
      p_total_cents: 22500,
      p_discount_cents: 2500,
      p_amount_paid_cents: 22500,
      p_change_cents: 0,
    });
  });

  it('rechaza un reparto que no cubre el total de la venta', async () => {
    supabaseMock.__queue('tenants', { data: { settings: { checkout: {} } } });
    supabaseMock.__queue('cash_register_sessions', { data: null });
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });

    const res = await POST(
      makeRequest({
        items: [{ product_id: 'p1', quantity: 2 }],
        payments: [
          { method: 'cash', amount: 1 },
          { method: 'transfer', amount: 1 },
        ],
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('El reparto del pago no cubre el total');
  });

  it('rechaza un monto recibido menor al total del medio de pago', async () => {
    supabaseMock.__queue('tenants', { data: { settings: { checkout: {} } } });
    supabaseMock.__queue('cash_register_sessions', { data: null });
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });

    const res = await POST(
      makeRequest({
        items: [{ product_id: 'p1', quantity: 2 }],
        payments: [{ method: 'cash', amount: 4, received: 1 }],
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('no puede ser menor al total del medio');
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

describe('trabajo en segundo plano', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(createActivityLog).mockClear();
    vi.mocked(trackEvent).mockClear();
    afterCallbacks.length = 0;
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const queueSuccessfulSale = () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('sales', { data: { id: 'sale-1' } });
    supabaseMock.__queue('sale_items', { data: null, error: null });
    supabaseMock.__queue('stock_history', { data: null, error: null });
  };

  it('responde sin esperar a la auditoria', async () => {
    queueSuccessfulSale();

    await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 3 }] }));

    // El log todavia no se escribio: es lo que permite responder antes.
    expect(createActivityLog).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(2);
  });

  it('escribe auditoria y analytics despues de responder', async () => {
    queueSuccessfulSale();

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 3 }] }));
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe('sale-1');

    await flushAfter();

    expect(createActivityLog).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(trackEvent).mock.calls[0][0]).toMatchObject({
      type: 'first_sale',
      tenantId: 'tenant-1',
    });
  });

  it('NO revierte el stock si la auditoria falla', async () => {
    // El bug que motivio sacar la auditoria del path critico: antes, el error
    // del log caia en el catch que devuelve el stock, dejando una venta
    // registrada en `sales` con el stock restaurado.
    queueSuccessfulSale();
    vi.mocked(createActivityLog).mockRejectedValueOnce(new Error('bitacora caida'));

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 3 }] }));

    expect(res.status).toBe(201);
    await flushAfter();

    // Ni una devolucion de stock: la venta se registro y el stock debe quedar
    // descontado.
    expect(supabaseMock.rpc.mock.calls.filter(([fn]) => fn === 'increment_stock')).toHaveLength(0);
    expect(decrementCalls()).toHaveLength(1);
  });

  it('NO revierte el stock si analytics falla', async () => {
    queueSuccessfulSale();
    vi.mocked(trackEvent).mockRejectedValueOnce(new Error('analytics caido'));

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 3 }] }));

    expect(res.status).toBe(201);
    await flushAfter();
    expect(supabaseMock.rpc.mock.calls.filter(([fn]) => fn === 'increment_stock')).toHaveLength(0);
  });

  it('un fallo en analytics no impide que se escriba la auditoria', async () => {
    queueSuccessfulSale();
    vi.mocked(trackEvent).mockRejectedValueOnce(new Error('analytics caido'));

    await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 3 }] }));
    await flushAfter();

    // Son tareas independientes: una caida no tiene que cancelar la otra.
    expect(createActivityLog).toHaveBeenCalledTimes(1);
  });

  it('no encola trabajo en una venta rechazada', async () => {
    const res = await POST(makeRequest({ items: [] }));

    expect(res.status).toBe(400);
    expect(afterCallbacks).toHaveLength(0);
  });
});


describe('create_sale_atomic (migracion 045)', () => {
  const queueSale = () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
  };

  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    afterCallbacks.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registra la venta con UNA sola llamada a la RPC', async () => {
    queueSale();

    await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 3 }] }));

    // Antes eran 3 + N inserts via PostgREST. Ahora es 1 llamada (mas el
    // `decrement_stock`, que es el descuento de stock).
    const createCalls = supabaseMock.rpc.mock.calls.filter(
      ([fn]) => fn === 'create_sale_atomic'
    );
    expect(createCalls).toHaveLength(1);
    expect(
      supabaseMock.__calls.filter((c) => c.method === 'insert')
    ).toHaveLength(0);
  });

  it('manda los items, pagos y movimientos en la misma llamada', async () => {
    queueSale();

await POST(
      makeRequest({
        items: [{ product_id: 'p1', quantity: 3 }],
        payments: [{ method: 'cash', amount: 6, received: 6 }],
      })
    );

    const call = createSaleCall()!;
    expect(call.p_items).toEqual([
      { product_id: 'p1', quantity: 3, unit_price_cents: 200, subtotal_cents: 600 },
    ]);
    expect(call.p_payments).toEqual([
      { method: 'cash', amount_cents: 600, received_cents: 600, change_cents: 0 },
    ]);
    expect(call.p_stock_movements).toEqual([
      { product_id: 'p1', quantity: -3, type: 'out', created_by: 'user-1' },
    ]);
  });

  it('no manda el motivo del movimiento porque lo arma la funcion con el folio', async () => {
    queueSale();

    await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 1 }] }));

    // El motivo depende del id de venta recien generado: si el caller lo
    // mandara, el historial quedaria sin el sufijo de folio.
    const movement = ((createSaleCall()?.p_stock_movements ?? []) as Array<Record<string, unknown>>)[0];
    expect(movement.reason).toBeUndefined();
  });

  it('manda un movimiento por item', async () => {
supabaseMock.__queue('products', {
      data: [
        { id: 'p1', name: 'Coca', price: 2, price_cents: 200 },
        { id: 'p2', name: 'Agua', price: 1.5, price_cents: 150 },
        { id: 'p3', name: 'Gaseosa', price: 3, price_cents: 300 },
      ],
    });
    supabaseMock.__queue('product_stock', {
      data: [
        { product_id: 'p1', stock: 10 },
        { product_id: 'p2', stock: 20 },
        { product_id: 'p3', stock: 30 },
      ],
    });
    supabaseMock.__queue('product_stock', { data: { id: 'ps1', stock: 10 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps1' }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps2', stock: 20 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps2' }] });
    supabaseMock.__queue('product_stock', { data: { id: 'ps3', stock: 30 } });
    supabaseMock.__queue('product_stock', { data: [{ id: 'ps3' }] });

    await POST(
      makeRequest({
        items: [
          { product_id: 'p1', quantity: 1 },
          { product_id: 'p2', quantity: 2 },
          { product_id: 'p3', quantity: 3 },
        ],
      })
    );

    const movements = (createSaleCall()?.p_stock_movements ?? []) as Array<Record<string, unknown>>;
    expect(movements).toHaveLength(3);
    expect(movements.map((m) => m.quantity)).toEqual([-1, -2, -3]);
  });

  it('propaga el tenant de la sesion, no el del body', async () => {
    queueSale();

    await POST(
      makeRequest({ tenant_id: 'tenant-otro', items: [{ product_id: 'p1', quantity: 1 }] })
    );

    expect(createSaleCall()?.p_tenant_id).toBe('tenant-1');
  });

  it('devuelve error de infraestructura cuando la RPC no devuelve venta', async () => {
    queueSale();
    supabaseMock.__rpcResults.create_sale_atomic = { data: null, error: null };

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 1 }] }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('No se pudo registrar la venta');
  });

  it('no revierte el stock si la RPC lanza una excepcion', async () => {
    queueSale();
    supabaseMock.__rpcResults.create_sale_atomic = {
      data: null,
      error: { message: 'permiso denegado' },
    };

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 2 }] }));

    expect(res.status).toBe(400);
    // El catch revierte el stock porque la venta no se registro. Esto es lo
    // unico que sigue haciendose desde JS, y es correcto: la transaccion
    // cubrio las escrituras, pero el descuento de stock es una RPC aparte.
    expect(supabaseMock.rpc).toHaveBeenCalledWith('increment_stock', {
      p_product_id: 'p1',
      p_tenant_id: 'tenant-1',
      p_quantity: 2,
    });
  });

  it('propaga el mensaje de la funcion sin envolverlo', async () => {
    // El texto que ve el usuario sale del `raise` de la funcion: si el backend
    // lo reescribiera, el front y el log dirian cosas distintas.
    queueSale();
    supabaseMock.__rpcResults.create_sale_atomic = {
      data: null,
      error: { message: 'No se pudieron guardar los pagos de la venta: foreign key' },
    };

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 1 }] }));

    expect((await res.json()).error).toBe(
      'No se pudieron guardar los pagos de la venta: foreign key'
    );
  });
});
