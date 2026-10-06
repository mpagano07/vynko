import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { receivePurchaseOrder } from './purchase-order-service';
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