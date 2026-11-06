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
