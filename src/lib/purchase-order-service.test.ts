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

const seqUpdates = () =>
  supabaseMock.__calls.filter(
    (c) => c.table === 'commercial_document_sequences' && c.method === 'update'
  );

const seqEqOnNextNumber = () =>
  supabaseMock.__calls
    .filter(
      (c) =>
        c.table === 'commercial_document_sequences' &&
        c.method === 'eq' &&
        c.args[0] === 'next_number'
    )
    .map((c) => c.args[1]);

describe('receivePurchaseOrder con numeracion', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    mockCreateActivityLog.mockClear();
  });

  it('reclama el numero del remito con compare-and-set en vez de un update ciego', async () => {
    supabaseMock.__queue('purchase_orders', {
      data: { id: 'po-1', status: 'pending', supplier: { name: 'Proveedor' } },
      error: null,
    });
    supabaseMock.__queue('purchase_order_items', {
      data: [{ id: 'pitem-1', product_id: 'prod-1', quantity_ordered: 10, quantity_received: 0, unit_cost_cents: 100, product: { name: 'Producto' } }],
      error: null,
    });
    supabaseMock.__queue('commercial_document_sequences', { data: { next_number: 5 }, error: null });
    supabaseMock.__queue('commercial_document_sequences', { data: [{ next_number: 6 }], error: null });
    supabaseMock.__queue('commercial_documents', { data: { id: 'doc-1' }, error: null });
    supabaseMock.__queue('purchase_order_items', { data: null, error: null });
    supabaseMock.__queue('product_stock', { data: { stock: 0 }, error: null });
    supabaseMock.__queue('product_stock', { data: null, error: null });
    supabaseMock.__queue('stock_history', { data: null, error: null });
    supabaseMock.__queue('purchase_orders', { data: null, error: null });
    supabaseMock.__queue('commercial_documents', { data: { id: 'doc-1' }, error: null });

    const result = await receivePurchaseOrder(AUTH, 'po-1', {
      items: [{ product_id: 'prod-1', quantity_received: 5 }],
    });

    expect(result.ok).toBe(true);

    // El claim es UN update con guard CAS sobre el valor leido...
    const updates = seqUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({ next_number: 6 });
    expect(seqEqOnNextNumber()).toContain(5);

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
});