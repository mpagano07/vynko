import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { createSale, hashSaleRequest } from '@/lib/sales-service';
import type { AuthInfo } from '@/lib/api-auth';

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));

const TENANT = '11111111-1111-1111-1111-111111111111';

const auth: AuthInfo = {
  userId: 'user-1',
  tenantId: TENANT,
  tenantIds: [TENANT],
  allTenants: false,
  role: 'owner',
};

const body = {
  customer_id: null,
  notes: 'reintento',
  items: [{ product_id: 'p1', quantity: 1 }],
  payment_method: 'cash',
  amount_paid: 10,
  discount_percent: 0,
  surcharge_percent: 0,
};

function queueReplay() {
  supabaseMock.__queue('sales', {
    data: { id: 'sale-1', tenant_id: TENANT, total_cents: 1000 },
    error: null,
  });
  supabaseMock.__queue('tenants', { data: { settings: {} }, error: null });
  supabaseMock.__queue('sale_items', {
    data: [
      {
        sale_id: 'sale-1',
        product_id: 'p1',
        quantity: 1,
        unit_price_cents: 1000,
        subtotal_cents: 1000,
        product: { name: 'Café' },
      },
    ],
    error: null,
  });
  supabaseMock.__queue('sale_payments', {
    data: [
      {
        sale_id: 'sale-1',
        method: 'cash',
        amount_cents: 1000,
        received_cents: 1000,
        change_cents: 0,
      },
    ],
    error: null,
  });
}

beforeEach(() => {
  supabaseMock.__reset();
});

describe('createSale: idempotencia', () => {
  it('reintenta con la misma clave y devuelve la venta original sin volver a crear', async () => {
    supabaseMock.__queue('sale_idempotency_keys', {
      data: { sale_id: 'sale-1', request_hash: hashSaleRequest(body) },
      error: null,
    });
    queueReplay();

    const result = await createSale(auth, body as never, 'clave-1');

    expect(result).toMatchObject({
      ok: true,
      sale: { id: 'sale-1' },
      items: [{ product_name: 'Café' }],
      payments: [{ method: 'cash', amount_cents: 1000 }],
    });
    // El replay no puede tocar stock ni la RPC transaccional.
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('rechaza con 409 si la clave ya se uso con otro contenido', async () => {
    supabaseMock.__queue('sale_idempotency_keys', {
      data: { sale_id: 'sale-1', request_hash: 'hash-de-otra-venta' },
      error: null,
    });

    const result = await createSale(auth, body as never, 'clave-1');

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('resuelve la carrera 23505 releyendo la fila ganadora', async () => {
    // Primer lectura: la clave todavia no existe, asi que se intenta crear.
    supabaseMock.__queue('sale_idempotency_keys', { data: null, error: null });
    // Insumos que la venta lee antes de llamar a la RPC.
    supabaseMock.__queue('tenants', { data: { settings: {} }, error: null });
    supabaseMock.__queue('cash_register_sessions', { data: null, error: null });
    supabaseMock.__queue('products', {
      data: [{ id: 'p1', name: 'Café', price_cents: 1000 }],
      error: null,
    });
    supabaseMock.__queue('product_stock', {
      data: [{ product_id: 'p1', stock: 5 }],
      error: null,
    });
    // La RPC pierde la carrera de la clave unica (23505).
    supabaseMock.__rpcQueue('create_sale_atomic', {
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    });
    // Segunda lectura: ya esta la fila del ganador, con el mismo hash.
    supabaseMock.__queue('sale_idempotency_keys', {
      data: { sale_id: 'sale-1', request_hash: hashSaleRequest(body) },
      error: null,
    });
    queueReplay();

    const result = await createSale(auth, body as never, 'clave-1');

    expect(result).toMatchObject({ ok: true, sale: { id: 'sale-1' } });
  });
});

interface SaleRpcArgs {
  p_items: Array<{
    product_id: string;
    variant_id: string | null;
    quantity: number;
    unit_price_cents: number;
    subtotal_cents: number;
  }>;
  p_stock_movements: Array<{
    product_id: string;
    variant_id: string | null;
    quantity: number;
  }>;
}

function saleRpcArgs(): SaleRpcArgs {
  const call = supabaseMock.rpc.mock.calls.find(([fn]) => fn === 'create_sale_atomic');
  return (call?.[1] ?? { p_items: [], p_stock_movements: [] }) as unknown as SaleRpcArgs;
}

/** Encola los insumos que `createSale` lee antes de la RPC, en orden de consulta. */
function queueVariantInputs(options: {
  variantRows?: unknown[];
  variantStock?: unknown[];
  ownerRows?: unknown[];
  withVariantLookups?: boolean;
}) {
  const { variantRows = [], variantStock = [], ownerRows = [], withVariantLookups = true } = options;
  supabaseMock.__queue('tenants', { data: { settings: {} }, error: null });
  supabaseMock.__queue('cash_register_sessions', { data: null, error: null });
  supabaseMock.__queue('products', {
    data: [{ id: 'p1', name: 'Remera', price_cents: 1000 }],
    error: null,
  });
  // Stock del padre alto a propósito: una venta de variante no debe usarlo.
  supabaseMock.__queue('product_stock', { data: [{ product_id: 'p1', stock: 99 }], error: null });
  if (withVariantLookups) {
    supabaseMock.__queue('product_variants', { data: variantRows, error: null });
    supabaseMock.__queue('variant_stock', { data: variantStock, error: null });
  }
  supabaseMock.__queue('product_variants', { data: ownerRows, error: null });
}

const variantSaleBody = {
  customer_id: null,
  notes: null,
  items: [{ product_id: 'p1', variant_id: 'v1', quantity: 2 }],
  payment_method: 'cash',
  amount_paid: 40,
  discount_percent: 0,
  surcharge_percent: 0,
};

const redVariant = { id: 'v1', product_id: 'p1', label: 'Rojo / M', price_cents: 1500 };

describe('createSale: variantes', () => {
  it('vende la variante con su precio, su stock y su descripción, y propaga variant_id a la RPC', async () => {
    queueVariantInputs({
      variantRows: [redVariant],
      variantStock: [{ variant_id: 'v1', stock: 5, active: true }],
    });

    const result = await createSale(auth, variantSaleBody as never);

    expect(result).toMatchObject({
      ok: true,
      items: [{
        variant_id: 'v1',
        product_name: 'Remera · Rojo / M',
        unit_price_cents: 1500,
        subtotal_cents: 3000,
      }],
    });
    // El precio del padre ($10) no se usa: el de la variante es $15.
    expect(saleRpcArgs().p_items).toEqual([{
      product_id: 'p1', variant_id: 'v1', quantity: 2,
      unit_price_cents: 1500, subtotal_cents: 3000,
    }]);
    expect(saleRpcArgs().p_stock_movements).toEqual([{
      product_id: 'p1', variant_id: 'v1', quantity: -2, type: 'out', created_by: 'user-1',
    }]);
  });

  it('rechaza vender el producto padre cuando tiene variantes activas', async () => {
    queueVariantInputs({
      ownerRows: [{ product_id: 'p1', variant_stock: [{ tenant_id: TENANT, active: true }] }],
      withVariantLookups: false,
    });

    const result = await createSale(auth, {
      ...variantSaleBody,
      items: [{ product_id: 'p1', quantity: 2 }],
    } as never);

    expect(result).toMatchObject({
      ok: false, status: 400,
      error: 'El producto "Remera" tiene variantes: elegí una variante para venderlo',
    });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('rechaza una variante que no pertenece al producto', async () => {
    queueVariantInputs({
      variantRows: [{ ...redVariant, product_id: 'otro-padre' }],
      variantStock: [{ variant_id: 'v1', stock: 9, active: true }],
    });

    const result = await createSale(auth, variantSaleBody as never);

    expect(result).toMatchObject({
      ok: false, status: 400,
      error: 'La variante no pertenece a este producto o sucursal',
    });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('rechaza una variante desactivada en la sucursal', async () => {
    queueVariantInputs({
      variantRows: [redVariant],
      variantStock: [{ variant_id: 'v1', stock: 9, active: false }],
    });

    const result = await createSale(auth, variantSaleBody as never);

    expect(result).toMatchObject({
      ok: false, status: 400,
      error: 'La variante "Rojo / M" está desactivada',
    });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('controla el stock contra la variante, no contra el padre', async () => {
    queueVariantInputs({
      variantRows: [redVariant],
      variantStock: [{ variant_id: 'v1', stock: 1, active: true }],
    });

    const result = await createSale(auth, variantSaleBody as never);

    expect(result).toMatchObject({
      ok: false, status: 400,
      error: 'Stock insuficiente para "Remera · Rojo / M" (disponible: 1)',
    });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('mantiene el flujo simple idéntico, con variant_id nulo en la RPC', async () => {
    queueVariantInputs({ ownerRows: [], withVariantLookups: false });

    const result = await createSale(auth, {
      ...variantSaleBody,
      items: [{ product_id: 'p1', quantity: 2 }],
    } as never);

    expect(result).toMatchObject({
      ok: true,
      items: [{ product_name: 'Remera', unit_price_cents: 1000, subtotal_cents: 2000 }],
    });
    expect(saleRpcArgs().p_items).toEqual([{
      product_id: 'p1', variant_id: null, quantity: 2,
      unit_price_cents: 1000, subtotal_cents: 2000,
    }]);
    expect(saleRpcArgs().p_stock_movements[0].variant_id).toBeNull();
  });
});
