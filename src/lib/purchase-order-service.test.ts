import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { createPurchaseOrder, listPurchaseOrders, listPendingPurchaseOrders, receivePurchaseOrder } from './purchase-order-service';
import type { AuthInfo } from '@/lib/api-auth';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

const mockCreateActivityLog = vi.fn();
vi.mock('@/lib/activity-log', () => ({
  createActivityLog: (...args: unknown[]) => mockCreateActivityLog(...args),
}));

vi.mock('@/lib/track-event', () => ({
  trackEvent: vi.fn(async () => undefined),
}));

vi.mock('@/lib/membership-role', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/membership-role')>();
  return { ...mod, getRoleInTenant: vi.fn(async () => 'owner') };
});

const AUTH: AuthInfo = { tenantId: 'tenant-1', userId: 'user-1' } as AuthInfo;

const ITEM = {
  id: 'pitem-1',
  product_id: 'prod-1',
  quantity_ordered: 10,
  quantity_received: 0,
  unit_cost_cents: 100,
  product: { name: 'Producto' },
};

// La recepcion lee la orden, sus items, reclama el numero del remito (select +
// update CAS), inserta el documento y sus items, llama por RPC a
// `receive_po_stock` y relee el documento completo para la respuesta.
const queueReceiveFlow = () => {
  supabaseMock.__queue('purchase_orders', {
    data: { id: 'po-1', status: 'pending', supplier: { name: 'Proveedor' } },
    error: null,
  });
  supabaseMock.__queue('purchase_order_items', { data: [ITEM], error: null });
  supabaseMock.__queue('commercial_document_sequences', { data: { next_number: 5 }, error: null });
  supabaseMock.__queue('commercial_document_sequences', { data: [{ next_number: 6 }], error: null });
  supabaseMock.__queue('commercial_documents', { data: { id: 'doc-1' }, error: null });
  supabaseMock.__queue('commercial_document_items', { data: null, error: null });
  supabaseMock.__queue('commercial_documents', { data: { id: 'doc-1' }, error: null });
};

const seqUpdates = () =>
  supabaseMock.__calls.filter(
    (c) => c.table === 'commercial_document_sequences' && c.method === 'update'
  );

describe('receivePurchaseOrder con numeracion', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    mockCreateActivityLog.mockClear();
  });

  it('reclama el numero del remito con compare-and-set y delega todo lo demas a receive_po_stock', async () => {
    queueReceiveFlow();
    supabaseMock.__rpcResults.receive_po_stock = {
      data: [{ ok: true, code: null, row: { status: 'received', received_date: '2026-10-06', all: true } }],
      error: null,
    };

    const result = await receivePurchaseOrder(AUTH, 'po-1', {
      items: [{ product_id: 'prod-1', quantity_received: 10 }],
    });

    expect(result.ok).toBe(true);

    // El claim es UN update con guard CAS sobre el valor leido...
    const updates = seqUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({ next_number: 6 });

    // ...y el remito usa ese numero.
    const docInsert = supabaseMock.__calls.find(
      (c) => c.table === 'commercial_documents' && c.method === 'insert'
    );
    expect(docInsert?.args[0]).toMatchObject({
      document_type: 'remito_ingreso',
      document_number: 5,
    });
    expect(mockCreateActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ remito_number: 5 }) })
    );
  });

  it('pasa a la RPC los incrementos capitados y ya NO hace read-modify-write del stock (051)', async () => {
    queueReceiveFlow();

    const result = await receivePurchaseOrder(AUTH, 'po-1', {
      items: [{ product_id: 'prod-1', quantity_received: 5 }],
    });

    expect(result.ok).toBe(true);

    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'receive_po_stock',
      expect.objectContaining({
        p_order_id: 'po-1',
        p_tenant_id: 'tenant-1',
        p_by: 'user-1',
        p_items: [{ product_id: 'prod-1', quantity_received: 5 }],
        p_deposito: null,
        p_pasillo: null,
        p_estanteria: null,
      })
    );

    // Nada de los viajes viejos: ni lectura/upsert de product_stock, ni
    // stock_history, ni update ciego de quantity_received o del status.
    const oldLoopCalls = supabaseMock.__calls.filter(
      (c) =>
        c.table === 'product_stock' ||
        c.table === 'stock_history' ||
        (c.table === 'purchase_order_items' && c.method === 'update') ||
        (c.table === 'purchase_orders' && c.method === 'update')
    );
    expect(oldLoopCalls).toHaveLength(0);
  });

  it('un P0001 de la RPC (tope superado) se propaga y devuelve el remito + el folio', async () => {
    queueReceiveFlow();
    supabaseMock.__rpcResults.receive_po_stock = {
      data: null,
      error: {
        code: 'P0001',
        message: 'No se puede recibir más de lo pedido para "Producto" (pedido: 10, recibido: 0, llegan: 12)',
      },
    };

    const result = await receivePurchaseOrder(AUTH, 'po-1', {
      items: [{ product_id: 'prod-1', quantity_received: 5 }],
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: 'No se puede recibir más de lo pedido para "Producto" (pedido: 10, recibido: 0, llegan: 12)',
    });

    // Compensacion: se borra el remito ya insertado y se devuelve su folio.
    const docDelete = supabaseMock.__calls.find(
      (c) => c.table === 'commercial_documents' && c.method === 'delete'
    );
    expect(docDelete).toBeDefined();
    const release = seqUpdates().find(
      (c) => (c.args[0] as Record<string, unknown>).next_number === 5
    );
    expect(release).toBeDefined();
  });

  it('una recepcion que ya gano otra request devuelve 400 y compensa el remito', async () => {
    queueReceiveFlow();
    supabaseMock.__rpcResults.receive_po_stock = {
      data: [{ ok: false, code: 'already_received', row: null }],
      error: null,
    };

    const result = await receivePurchaseOrder(AUTH, 'po-1', {
      items: [{ product_id: 'prod-1', quantity_received: 5 }],
    });

    expect(result).toMatchObject({ ok: false, status: 400, error: 'El pedido ya fue recibido' });
    expect(
      supabaseMock.__calls.some((c) => c.table === 'commercial_documents' && c.method === 'delete')
    ).toBe(true);
  });

  it('una orden cancelada entre medias devuelve 400', async () => {
    queueReceiveFlow();
    supabaseMock.__rpcResults.receive_po_stock = {
      data: [{ ok: false, code: 'cancelled', row: null }],
      error: null,
    };

    const result = await receivePurchaseOrder(AUTH, 'po-1', {
      items: [{ product_id: 'prod-1', quantity_received: 5 }],
    });

    expect(result).toMatchObject({ ok: false, status: 400, error: 'El pedido fue cancelado' });
  });

  it('una orden que desaparecio entre medias devuelve 404', async () => {
    queueReceiveFlow();
    supabaseMock.__rpcResults.receive_po_stock = {
      data: [{ ok: false, code: 'not_found', row: null }],
      error: null,
    };

    const result = await receivePurchaseOrder(AUTH, 'po-1', {
      items: [{ product_id: 'prod-1', quantity_received: 5 }],
    });

    expect(result).toMatchObject({ ok: false, status: 404, error: 'Pedido no encontrado' });
  });
});

describe('listas de pedidos de compra', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    mockCreateActivityLog.mockClear();
  });

  it('listPurchaseOrders aplana proveedor y producto por item', async () => {
    supabaseMock.__queue('purchase_orders', {
      data: [
        {
          id: 'po-1',
          tenant_id: 'tenant-1',
          status: 'sent',
          supplier: { name: 'Proveedor Uno' },
          items: [
            { id: 'pitem-1', product: { name: 'Producto A' } },
            { id: 'pitem-2', product: { name: 'Producto B' } },
          ],
        },
      ],
      error: null,
    });

    const result = await listPurchaseOrders(AUTH, null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Conserva los campos del join (spread) y agrega los aplanados.
    expect(result.data).toEqual([
      {
        id: 'po-1',
        tenant_id: 'tenant-1',
        status: 'sent',
        supplier: { name: 'Proveedor Uno' },
        supplier_name: 'Proveedor Uno',
        items: [
          { id: 'pitem-1', product: { name: 'Producto A' }, product_name: 'Producto A' },
          { id: 'pitem-2', product: { name: 'Producto B' }, product_name: 'Producto B' },
        ],
      },
    ]);
  });

  it('listPurchaseOrders filtra por proveedor cuando se pide', async () => {
    supabaseMock.__queue('purchase_orders', { data: [], error: null });

    const result = await listPurchaseOrders(AUTH, 'sup-1');

    expect(result.ok).toBe(true);
    const supplierFilter = supabaseMock.__calls.find(
      (c) => c.table === 'purchase_orders' && c.method === 'select'
    );
    expect(supplierFilter).toBeDefined();
  });

  it('listPendingPurchaseOrders deja sólo items con cantidad pendiente', async () => {
    supabaseMock.__queue('purchase_orders', {
      data: [
        {
          id: 'po-1',
          status: 'partial',
          expected_date: '2026-11-20',
          created_at: '2026-11-01',
          supplier: { name: 'Proveedor Uno' },
          items: [
            // 10 pedidos, 4 recibidos: quedan 6 pendientes.
            { quantity_ordered: 10, quantity_received: 4, product: { id: 'prod-1', name: 'Producto A' } },
            // Este item ya está completo: se filtra del resultado.
            { quantity_ordered: 5, quantity_received: 5, product: { id: 'prod-2', name: 'Producto B' } },
          ],
        },
        // Pedido totalmente recibido: queda sin items y se descarta entero.
        {
          id: 'po-2',
          status: 'received',
          expected_date: null,
          created_at: '2026-11-02',
          supplier: null,
          items: [{ quantity_ordered: 3, quantity_received: 3, product: null }],
        },
      ],
      error: null,
    });

    const result = await listPendingPurchaseOrders(AUTH);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      {
        id: 'po-1',
        status: 'partial',
        expected_date: '2026-11-20',
        created_at: '2026-11-01',
        supplier_name: 'Proveedor Uno',
        items: [
          {
            product_id: 'prod-1',
            product_name: 'Producto A',
            quantity_ordered: 10,
            quantity_received: 4,
            quantity_pending: 6,
          },
        ],
      },
    ]);
  });

  it('listPendingPurchaseOrders propaga el error de la consulta', async () => {
    supabaseMock.__queue('purchase_orders', { data: null, error: { message: 'boom', code: 'XX000' } });

    const result = await listPendingPurchaseOrders(AUTH);

    expect(result).toMatchObject({ ok: false, status: 500, error: 'Ocurrio un error inesperado. Intenta de nuevo.' });
  });

  it('muestra la etiqueta de la variante en el nombre del item', async () => {
    supabaseMock.__queue('purchase_orders', {
      data: [
        {
          id: 'po-1',
          tenant_id: 'tenant-1',
          status: 'sent',
          supplier: { name: 'Proveedor Uno' },
          items: [
            {
              id: 'pitem-1',
              product: { name: 'Producto' },
              variant: { label: '128 GB' },
            },
          ],
        },
      ],
      error: null,
    });

    const result = await listPurchaseOrders(AUTH, null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as Array<{ items: Array<{ product_name: string }> }>)[0].items[0].product_name).toBe(
      'Producto · 128 GB'
    );
  });
});

const queueCreateFlow = (productRows: unknown[], variantRows?: unknown[]) => {
  supabaseMock.__queue('products', { data: productRows, error: null });
  if (variantRows) supabaseMock.__queue('product_variants', { data: variantRows[0], error: null });
  supabaseMock.__queue('providers', { data: [], error: null });
  supabaseMock.__queue('suppliers', {
    data: [{ id: 'sup-1', name: 'Proveedor', payment_term_days: null }],
    error: null,
  });
  supabaseMock.__queue('purchase_orders', { data: { id: 'po-1' }, error: null });
  supabaseMock.__queue('purchase_order_items', { data: null, error: null });
};

const createdItemsInsert = () =>
  supabaseMock.__calls.find(
    (c) => c.table === 'purchase_order_items' && c.method === 'insert'
  )?.args[0] as Array<Record<string, unknown>> | undefined;

describe('createPurchaseOrder con variantes', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    mockCreateActivityLog.mockClear();
  });

  it('guarda un producto simple sin variant_id y respeta su costo', async () => {
    queueCreateFlow([{ id: 'prod-1', name: 'Producto', cost: 10, cost_cents: 1000 }]);

    const result = await createPurchaseOrder(AUTH, {
      supplier_id: 'sup-1',
      items: [{ product_id: 'prod-1', quantity: 2, unit_cost: 12.5 }],
    });

    expect(result.ok).toBe(true);
    expect(createdItemsInsert()).toEqual([
      {
        purchase_order_id: 'po-1',
        product_id: 'prod-1',
        quantity_ordered: 2,
        quantity_received: 0,
        unit_cost_cents: 1250,
      },
    ]);
    expect(
      supabaseMock.__calls.some((c) => c.table === 'product_variants')
    ).toBe(false);
  });

  it('usa el costo de la variante de la DB e ignora el unit_cost del cliente', async () => {
    queueCreateFlow(
      [{ id: 'prod-1', name: 'Producto', cost: 10, cost_cents: 1000 }],
      [{
        id: 'var-1',
        product_id: 'prod-1',
        label: '128 GB',
        cost: 12.75,
        variant_stock: [{ tenant_id: 'tenant-1', stock: 4, active: true }],
      }]
    );

    const result = await createPurchaseOrder(AUTH, {
      supplier_id: 'sup-1',
      items: [{ product_id: 'prod-1', variant_id: 'var-1', quantity: 3, unit_cost: 999 }],
    });

    expect(result.ok).toBe(true);
    expect(createdItemsInsert()).toEqual([
      {
        purchase_order_id: 'po-1',
        product_id: 'prod-1',
        variant_id: 'var-1',
        quantity_ordered: 3,
        quantity_received: 0,
        unit_cost_cents: 1275,
      },
    ]);
  });

  it('rechaza una variante cuyo stock pertenece a otra sucursal', async () => {
    queueCreateFlow(
      [{ id: 'prod-1', name: 'Producto', cost: 10, cost_cents: 1000 }],
      [{
        id: 'var-1',
        product_id: 'prod-1',
        label: '128 GB',
        cost: 12,
        variant_stock: [{ tenant_id: 'tenant-2', stock: 4, active: true }],
      }]
    );

    const result = await createPurchaseOrder(AUTH, {
      supplier_id: 'sup-1',
      items: [{ product_id: 'prod-1', variant_id: 'var-1', quantity: 1 }],
    });

    expect(result).toMatchObject({ ok: false, status: 400, error: 'La variante no pertenece al producto o a la sucursal' });
    expect(
      supabaseMock.__calls.some((c) => c.table === 'purchase_orders' && c.method === 'insert')
    ).toBe(false);
  });

  it('rechaza una variante que no pertenece al producto de la línea', async () => {
    queueCreateFlow(
      [{ id: 'prod-1', name: 'Producto', cost: 10, cost_cents: 1000 }],
      [{
        id: 'var-1',
        product_id: 'prod-other',
        label: '128 GB',
        cost: 12,
        variant_stock: [{ tenant_id: 'tenant-1', stock: 4, active: true }],
      }]
    );

    const result = await createPurchaseOrder(AUTH, {
      supplier_id: 'sup-1',
      items: [{ product_id: 'prod-1', variant_id: 'var-1', quantity: 1 }],
    });

    expect(result.ok).toBe(false);
    expect(
      supabaseMock.__calls.some((c) => c.table === 'purchase_orders' && c.method === 'insert')
    ).toBe(false);
  });
});

describe('receivePurchaseOrder con variantes', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    mockCreateActivityLog.mockClear();
  });

  const queueReceiveWithItems = (poItems: unknown[]) => {
    supabaseMock.__queue('purchase_orders', {
      data: { id: 'po-1', status: 'pending', supplier: { name: 'Proveedor' } },
      error: null,
    });
    supabaseMock.__queue('purchase_order_items', { data: poItems, error: null });
    supabaseMock.__queue('commercial_document_sequences', { data: { next_number: 5 }, error: null });
    supabaseMock.__queue('commercial_document_sequences', { data: [{ next_number: 6 }], error: null });
    supabaseMock.__queue('commercial_documents', { data: { id: 'doc-1' }, error: null });
    supabaseMock.__queue('commercial_document_items', { data: null, error: null });
    supabaseMock.__queue('commercial_documents', { data: { id: 'doc-1' }, error: null });
  };

  it('hace match por producto + variante y guarda descripciones completas en el remito', async () => {
    queueReceiveWithItems([
      { id: 'i-simple', product_id: 'prod-1', quantity_ordered: 4, quantity_received: 0, unit_cost_cents: 100, product: { name: 'Producto' } },
      { id: 'i-var', product_id: 'prod-1', variant_id: 'var-1', quantity_ordered: 5, quantity_received: 0, unit_cost_cents: 200, product: { name: 'Producto' }, variant: { label: '128 GB' } },
      { id: 'i-var2', product_id: 'prod-1', variant_id: 'var-2', quantity_ordered: 6, quantity_received: 0, unit_cost_cents: 300, product: { name: 'Producto' }, variant: { label: '256 GB' } },
    ]);

    const result = await receivePurchaseOrder(AUTH, 'po-1', {
      items: [
        { product_id: 'prod-1', quantity_received: 1 },
        { product_id: 'prod-1', variant_id: 'var-2', quantity_received: 2 },
        { product_id: 'prod-1', variant_id: 'var-1', quantity_received: 3 },
      ],
    });

    expect(result.ok).toBe(true);
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'receive_po_stock',
      expect.objectContaining({
        p_items: [
          { product_id: 'prod-1', quantity_received: 1 },
          { product_id: 'prod-1', variant_id: 'var-1', quantity_received: 3 },
          { product_id: 'prod-1', variant_id: 'var-2', quantity_received: 2 },
        ],
      })
    );

    const docItems = supabaseMock.__calls.find(
      (c) => c.table === 'commercial_document_items' && c.method === 'insert'
    )?.args[0] as Array<Record<string, unknown>>;
    expect(docItems.map((i) => i.description)).toEqual([
      'Producto',
      'Producto · 128 GB',
      'Producto · 256 GB',
    ]);
    expect(docItems[1]).toMatchObject({ variant_id: 'var-1' });
    expect(docItems[0]).not.toHaveProperty('variant_id');
  });

  it('ignora una variante/producto que no está en la orden', async () => {
    queueReceiveWithItems([ITEM]);

    const result = await receivePurchaseOrder(AUTH, 'po-1', {
      items: [{ product_id: 'prod-foreign', variant_id: 'var-foreign', quantity_received: 5 }],
    });

    expect(result).toMatchObject({ ok: false, status: 400, error: 'Ingresa una cantidad válida para recibir' });
    expect(
      supabaseMock.__calls.some((c) => c.table === 'commercial_documents' && c.method === 'insert')
    ).toBe(false);
  });
});