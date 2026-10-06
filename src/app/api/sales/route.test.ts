import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { createActivityLog } from '@/lib/activity-log';
import { trackEvent } from '@/lib/track-event';
import { hashSaleRequest } from '@/lib/sales-service';
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

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

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

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(url: string): Request {
  return new Request(url, { method: 'GET' });
}

/**
 * Llamadas a `create_sale_atomic` (migraciones 045/048).
 *
 * La venta entera (incluido el descuento de stock) viaja en una sola llamada
 * por RPC. Los tests afirman sobre los argumentos que recibe, no sobre el SQL.
 */
function createSaleCall(): Record<string, unknown> | undefined {
  const call = supabaseMock.rpc.mock.calls.find(([fn]) => fn === 'create_sale_atomic');
  return call?.[1] as Record<string, unknown> | undefined;
}

function saleItemsArg(): Array<Record<string, unknown>> | undefined {
  return createSaleCall()?.p_items as Array<Record<string, unknown>> | undefined;
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

    // El descuento de stock ya no es un RPC aparte que corriera antes de la
    // venta: vive adentro de la misma transaccion (048). Para la venta entera
    // hay UNA sola llamada por RPC, y el descuento viaja en `p_items` con la
    // cantidad pedida y el tenant de la sesion (no el del body).
    expect(supabaseMock.rpc.mock.calls.map(([fn]) => fn)).toEqual(['create_sale_atomic']);
    expect(saleItemsArg()?.[0]).toMatchObject({ product_id: 'p1', quantity: 3 });

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

    // Un solo viaje por RPC: el descuento de los dos items vive en la misma
    // transaccion que la venta (048), ya no hay N llamadas a `decrement_stock`.
    expect(supabaseMock.rpc.mock.calls.map(([fn]) => fn)).toEqual(['create_sale_atomic']);
    expect(saleItemsArg()).toHaveLength(2);
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

  it('devuelve 400 sin revertir stock cuando la RPC falla: la transaccion ya lo cubre', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });

    // El mensaje lo arma la funcion con el `raise`, y es el mismo texto que ya
    // mostraba el front cuando fallaba el insert de items. `code: P0001` es el
    // SQLSTATE del `raise`: la senal que distingue un error de negocio de uno
    // de infraestructura.
    supabaseMock.__rpcResults.create_sale_atomic = {
      data: null,
      error: { code: 'P0001', message: 'No se pudieron guardar los ítems de la venta' },
    };

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 2 }] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('No se pudieron guardar los ítems de la venta');

    // Ya no hace falta un `delete` compensatorio sobre `sales`: la transaccion
    // de `create_sale_atomic` no deja la venta a medio escribir. Ese delete era
    // justamente la fuente de ventas huerfanas cuando el propio delete fallaba.
    expect(supabaseMock.__calls.some((c) => c.table === 'sales' && c.method === 'delete')).toBe(false);

    // Tampoco hay `increment_stock` desde JS (048): el descuento se revierte
    // con el rollback de la transaccion, que incluye al stock.
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('increment_stock', expect.anything());
    expect(createActivityLog).not.toHaveBeenCalled();
  });

  it('devuelve 400 cuando la RPC rechaza por stock, sin registrar nada', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    // La lectura inicial dice 10 y alcanza, asi que la venta pasa el fail-fast.
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });

    // Otra venta se adelanto y el descuento atomico adentro de la funcion ya
    // no puede: este es el caso residual que cubre el `stock >= qty` del UPDATE
    // en la transaccion (048). El mensaje sale del `raise` de la funcion.
    supabaseMock.__rpcResults.create_sale_atomic = {
      data: null,
      error: { code: 'P0001', message: 'Stock insuficiente para "Coca" (disponible: 1)' },
    };

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 3 }] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Stock insuficiente para "Coca" (disponible: 1)');

    // Nada de lo que viene despues puede escribirse, y como el descuento vive
    // en la misma transaccion fallida, tampoco hay nada que devolver.
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('increment_stock', expect.anything());
  });

  it('no reporta un error de infraestructura de la RPC como conflicto de stock', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });

    // Un error de permisos (42501) no es "vende otra vez" ni "Stock
    // insuficiente": el mensaje tiene que llevar a revisar el servidor, no a
    // reintentar a ciegas. Solo los `raise` de la funcion (P0001) se muestran.
    supabaseMock.__rpcResults.create_sale_atomic = {
      data: null,
      error: { code: '42501', message: 'permission denied for function create_sale_atomic' },
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

  it('NO devuelve el stock si la auditoria falla', async () => {
    // Desde 048 no hay stock que devolver: la transaccion de la RPC cubrio
    // venta y descuento juntos, y un fallo de auditoria llega despues. Antes,
    // el error del log caia en el catch que restauraba el stock, dejando una
    // venta registrada con el stock de vuelta.
    queueSuccessfulSale();
    vi.mocked(createActivityLog).mockRejectedValueOnce(new Error('bitacora caida'));

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 3 }] }));

    expect(res.status).toBe(201);
    await flushAfter();

    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('increment_stock', expect.anything());
  });

  it('NO devuelve el stock si analytics falla', async () => {
    queueSuccessfulSale();
    vi.mocked(trackEvent).mockRejectedValueOnce(new Error('analytics caido'));

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 3 }] }));

    expect(res.status).toBe(201);
    await flushAfter();
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('increment_stock', expect.anything());
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

    // Antes eran 3 + N inserts via PostgREST mas una RPC de stock por item.
    // Ahora es 1 sola llamada a `create_sale_atomic`.
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

  it('no devuelve el stock si la RPC de venta lanza una excepcion', async () => {
    queueSale();
    supabaseMock.__rpcResults.create_sale_atomic = {
      data: null,
      error: { message: 'permiso denegado' },
    };

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 2 }] }));

    expect(res.status).toBe(400);
    // La transaccion de `create_sale_atomic` cubre venta Y descuento (048):
    // si falla, Postgres revierte el stock. Un `increment_stock` compensatorio
    // seria doble descuento/restauracion, logica que la RPC ya garantiza.
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('increment_stock', expect.anything());
  });

  it('propaga el mensaje de la funcion sin envolverlo', async () => {
    // El texto que ve el usuario sale del `raise` de la funcion: si el backend
    // lo reescribiera, el front y el log dirian cosas distintas. `P0001` es el
    // SQLSTATE del `raise`, la senal de que el mensaje es de negocio.
    queueSale();
    supabaseMock.__rpcResults.create_sale_atomic = {
      data: null,
      error: { code: 'P0001', message: 'No se pudieron guardar los pagos de la venta: foreign key' },
    };

    const res = await POST(makeRequest({ items: [{ product_id: 'p1', quantity: 1 }] }));

    expect((await res.json()).error).toBe(
      'No se pudieron guardar los pagos de la venta: foreign key'
    );
  });
});

describe('idempotencia de la venta (migracion 048)', () => {
  const body = { items: [{ product_id: 'p1', quantity: 3 }] };

  // El hash que espera el servidor para un body dado. Se importa la funcion
  // real: el test afirma el CONTRATO, y si la comparacion cambiara, este test
  // ya no estaria describiendo como se identifican los reintentos.
  const expectedHash = hashSaleRequest(body);

  const queueReplayReads = (saleId = 'sale-1') => {
    supabaseMock.__queue('sales', {
      data: { id: saleId, total_cents: 600, created_at: '2026-01-01T00:00:00Z' },
    });
    supabaseMock.__queue('tenants', { data: { settings: { checkout: {} } } });
    supabaseMock.__queue('sale_items', {
      data: [{ sale_id: saleId, product_id: 'p1', quantity: 3, unit_price_cents: 200, subtotal_cents: 600 }],
    });
    supabaseMock.__queue('sale_payments', {
      data: [{ sale_id: saleId, method: 'cash', amount_cents: 600, received_cents: 600, change_cents: 0 }],
    });
  };

  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
    afterCallbacks.length = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replay: devuelve la venta de la clave sin tocar stock ni RPC', async () => {
    supabaseMock.__queue('sale_idempotency_keys', {
      data: { sale_id: 'sale-1', request_hash: expectedHash },
    });
    queueReplayReads();

    const res = await POST(makeRequest(body, { 'Idempotency-Key': 'intento-1' }));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.id).toBe('sale-1');
    expect(json.items).toHaveLength(1);
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('create_sale_atomic', expect.anything());
  });

  it('rechaza con 409 una clave reusada para otra venta', async () => {
    // Otra compra (descuento 50%) ocupo la clave: el hash no coincide.
    supabaseMock.__queue('sale_idempotency_keys', {
      data: { sale_id: 'sale-otra', request_hash: '0'.repeat(64) },
    });

    const res = await POST(makeRequest(body, { 'Idempotency-Key': 'intento-1' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('La clave de idempotencia ya fue usada con otra venta');
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('carrera (23505): replica la venta del ganador', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });

    // Los dos vecinos mandaron el mismo intento; este llego segundo y la
    // funcion aborto con unique_violation despues de que el ganador se
    // registro. El servicio relee la fila ganadora y responde ESA venta.
    supabaseMock.__rpcResults.create_sale_atomic = {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    };
    // Primera lectura (fail-fast): la clave todavia no existe. Segunda lectura
    // (tras el 23505): ya existe la fila del ganador, que es la autoridad.
    supabaseMock.__queue('sale_idempotency_keys', { data: null });
    supabaseMock.__queue('sale_idempotency_keys', {
      data: { sale_id: 'sale-1', request_hash: expectedHash },
    });
    queueReplayReads();

    const res = await POST(makeRequest(body, { 'Idempotency-Key': 'intento-1' }));
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe('sale-1');

    // El perdedor no reintento: la clave del ganador es autoridad.
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
  });

  it('pasa la clave y el hash a la RPC', async () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });

    const res = await POST(makeRequest(body, { 'Idempotency-Key': 'intento-1' }));
    expect(res.status).toBe(201);

    expect(createSaleCall()).toMatchObject({
      p_idempotency_key: 'intento-1',
      p_request_hash: expectedHash,
    });
  });

  it('rechaza claves vacias o muy largas sin llegar a la RPC', async () => {
    const res = await POST(makeRequest(body, { 'Idempotency-Key': '   ' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Idempotency-Key inválida');

    const long = await POST(makeRequest(body, { 'Idempotency-Key': 'k'.repeat(256) }));
    expect(long.status).toBe(400);

    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('create_sale_atomic', expect.anything());
  });
});

describe('concurrencia (Fase 2)', () => {
  const body = { items: [{ product_id: 'p1', quantity: 3 }] };

  // Dos requests en paralelo contra el mismo producto. Cada uno usa su propia
  // columna de pre-checks (products + product_stock); la RPC es la que decide
  // quien gana.
  const queueTwoSalesPreReads = () => {
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Coca', price: 2, price_cents: 200 }],
    });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
    supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 10 }] });
  };

  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
    afterCallbacks.length = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dos ventas paralelas al mismo producto: la RPC deja pasar una sola', async () => {
    queueTwoSalesPreReads();

    // La funcion serializa el descuento bajo lock: la primera llamada gana el
    // stock y la segunda choca contra el `stock >= qty` del UPDATE condicional.
    supabaseMock.__rpcQueue(
      'create_sale_atomic',
      { data: { id: 'sale-1' }, error: null },
      { data: null, error: { code: 'P0001', message: 'Stock insuficiente para "Coca" (disponible: 0)' } }
    );

    const [ra, rb] = await Promise.all([
      POST(makeRequest(body, { 'Idempotency-Key': 'intento-a' })),
      POST(makeRequest(body, { 'Idempotency-Key': 'intento-b' })),
    ]);

    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([201, 400]);

    const loser = ra.status === 400 ? ra : rb;
    expect((await loser.json()).error).toBe(
      'Stock insuficiente para "Coca" (disponible: 0)'
    );

    // Una llamada por vecino y ninguna compensacion desde el backend: el
    // perdedor no hizo nada porque su transaccion entera quedo revertida.
    const createCalls = supabaseMock.rpc.mock.calls.filter(
      ([fn]) => fn === 'create_sale_atomic'
    );
    expect(createCalls).toHaveLength(2);
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('increment_stock', expect.anything());
  });

  it('carrera de idempotencia en paralelo: replica al ganador y no descuenta dos veces', async () => {
    queueTwoSalesPreReads();

    // Mismo intento desde dos vecinos. Quien gana la RPC registra la venta y
    // su clave; el otro choca contra unique_violation (23505) y, tras releer la
    // clave, responde la venta del ganador sin reintentar la RPC.
    supabaseMock.__rpcQueue(
      'create_sale_atomic',
      { data: { id: 'sale-1' }, error: null },
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
    );

    // Pre-checks de ambos (sin fila todavia) + la fila ganadora para el replay
    // del perdedor. Cualquiera sea quien gane la RPC, se consumen los mismos
    // tres: dos lecturas vacias de pre-check y una del ganador.
    supabaseMock.__queue('sale_idempotency_keys', { data: null });
    supabaseMock.__queue('sale_idempotency_keys', { data: null });
    supabaseMock.__queue('sale_idempotency_keys', {
      data: { sale_id: 'sale-1', request_hash: hashSaleRequest(body) },
    });

    // Replay: al `sales` recuperado del ganador hay que vestirle la respuesta
    // con items y pagos.
    supabaseMock.__queue('sales', {
      data: { id: 'sale-1', total_cents: 600, created_at: '2026-01-01T00:00:00Z' },
    });
    supabaseMock.__queue('tenants', { data: { settings: { checkout: {} } } });
    supabaseMock.__queue('sale_items', {
      data: [{ sale_id: 'sale-1', product_id: 'p1', quantity: 3, unit_price_cents: 200, subtotal_cents: 600 }],
    });
    supabaseMock.__queue('sale_payments', {
      data: [{ sale_id: 'sale-1', method: 'cash', amount_cents: 600, received_cents: 600, change_cents: 0 }],
    });

    const [ra, rb] = await Promise.all([
      POST(makeRequest(body, { 'Idempotency-Key': 'intento-1' })),
      POST(makeRequest(body, { 'Idempotency-Key': 'intento-1' })),
    ]);

    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
    expect((await ra.json()).id).toBe('sale-1');
    expect((await rb.json()).id).toBe('sale-1');

    // Exactamente dos intentos a la RPC (uno por vecino): el stock se desconto
    // una sola vez y el perdedor respondio con la venta ya registrada.
    const createCalls = supabaseMock.rpc.mock.calls.filter(
      ([fn]) => fn === 'create_sale_atomic'
    );
    expect(createCalls).toHaveLength(2);
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('increment_stock', expect.anything());
  });
});
