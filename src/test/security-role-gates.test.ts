import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { getAuth } from '@/lib/api-auth';

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

const serverAuthMock = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: 'user-1', email: 'a@b.com' } }, error: null })),
  },
};

vi.mock('@/lib/supabase', () => ({
  createServerSupabaseClient: vi.fn(async () => serverAuthMock),
  hardenSessionCookieOptions: (options: Record<string, unknown>) => options,
}));

vi.mock('@/lib/mercadopago', () => ({
  createPreApproval: vi.fn(async () => ({ id: 'pre-1', init_point: 'https://mp.test/checkout' })),
  cancelPreApproval: vi.fn(async () => undefined),
  getPayment: vi.fn(async () => ({})),
}));

import { POST as createCheckout } from '@/app/api/billing/create-checkout/route';
import { POST as cancelSubscription } from '@/app/api/billing/portal/route';
import { POST as openCashRegister } from '@/app/api/cash-register/route';
import { PATCH as updateDocument, DELETE as deleteDocument } from '@/app/api/documents/[id]/route';
import { POST as createSupplier } from '@/app/api/suppliers/route';
import { PATCH as updateSupplier, DELETE as deleteSupplier } from '@/app/api/suppliers/[id]/route';
import { POST as createPurchaseOrder } from '@/app/api/purchase-orders/route';
import { PATCH as updatePurchaseOrder } from '@/app/api/purchase-orders/[id]/route';
import { POST as receivePurchaseOrder } from '@/app/api/purchase-orders/[id]/receive/route';
import { PATCH as updateTransferStatus, DELETE as deleteTransfer } from '@/app/api/stock-transfers/[id]/route';
import { POST as closeCashBox } from '@/app/api/cash-register/[id]/close/route';
import { POST as recordCashMovement } from '@/app/api/cash-register/[id]/movements/route';
import {
  PATCH as updateProduct,
  DELETE as deleteProduct,
} from '@/app/api/products/[id]/route';
import { POST as adjustProductStock } from '@/app/api/products/[id]/adjust/route';
import { POST as adjustPrices } from '@/app/api/products/adjust-prices/route';
import { PATCH as updateCollaborator, DELETE as deleteCollaborator } from '@/app/api/settings/collaborators/[id]/route';
import { POST as completeOnboarding } from '@/app/api/onboarding/route';

const idParams = { params: Promise.resolve({ id: 'doc-1' }) } as never;
const supplierParams = { params: Promise.resolve({ id: 'sup-1' }) } as never;
const poParams = { params: Promise.resolve({ id: 'po-1' }) } as never;
const transferParams = { params: Promise.resolve({ id: 'tr-1' }) } as never;
const productParams = { params: Promise.resolve({ id: 'prod-1' }) } as never;
const collaboratorParams = { params: Promise.resolve({ id: 'user-9' }) } as never;

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-active-tenant-id': 'tenant-1',
      origin: 'http://localhost',
      host: 'localhost',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  supabaseMock.__reset();
  vi.mocked(getAuth).mockResolvedValue(mockAuth);
  serverAuthMock.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user-1', email: 'a@b.com' } },
    error: null,
  });
});

describe('gateos por rol', () => {
  it('caja: un member no abre la caja', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ role: 'member' }], error: null });
    const res = await openCashRegister(jsonRequest('http://localhost/api/cash-register', 'POST', { initial_fund: 100 }));
    expect(res.status).toBe(403);
    const inserts = supabaseMock.__calls.filter(
      (c) => c.table === 'cash_register_sessions' && c.method === 'insert'
    );
    expect(inserts).toHaveLength(0);
  });

  it('caja: un manager sí puede abrirla', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ role: 'manager' }], error: null });
    supabaseMock.__queue('cash_register_sessions', { data: null, error: null });
    supabaseMock.__queue('cash_register_sessions', { data: { id: 'sess-1' }, error: null });
    supabaseMock.__queue('cash_movements', { data: null, error: null });

    const res = await openCashRegister(jsonRequest('http://localhost/api/cash-register', 'POST', { initial_fund: 100 }));
    expect(res.status).toBe(201);
  });

  it('checkout: un member no puede cambiar la suscripción', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1', role: 'member' }], error: null });
    const res = await createCheckout(jsonRequest('http://localhost/api/billing/create-checkout', 'POST', { plan: 'business' }));
    expect(res.status).toBe(403);
  });

  it('checkout: un manager sí puede', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1', role: 'manager' }], error: null });
    supabaseMock.__queue('tenants', { data: { name: 'Acme', billing_email: 'billing@acme.test' }, error: null });
    supabaseMock.__queue('tenants', { data: null, error: null });

    const res = await createCheckout(jsonRequest('http://localhost/api/billing/create-checkout', 'POST', { plan: 'business' }));
    expect(res.status).toBe(200);
  });

  it('cancelación: un member no cancela la suscripción', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1', role: 'member' }], error: null });
    const res = await cancelSubscription(jsonRequest('http://localhost/api/billing/portal', 'POST'));
    expect(res.status).toBe(403);
    const updates = supabaseMock.__calls.filter((c) => c.table === 'tenants' && c.method === 'update');
    expect(updates).toHaveLength(0);
  });

  it('cancelación: un owner sí cancela', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1', role: 'owner' }], error: null });
    supabaseMock.__queue('tenants', {
      data: { mercadopago_preapproval_id: 'pre-1', subscription_current_period_end: null },
      error: null,
    });
    supabaseMock.__queue('tenants', { data: null, error: null });

    const res = await cancelSubscription(jsonRequest('http://localhost/api/billing/portal', 'POST'));
    expect(res.status).toBe(200);
    const update = supabaseMock.__calls.find((c) => c.table === 'tenants' && c.method === 'update');
    expect(update?.args[0]).toMatchObject({ subscription_status: 'canceled' });
  });

  it('documentos: un member no cambia el estado de un documento', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
    const res = await updateDocument(
      jsonRequest('http://localhost/api/documents/doc-1', 'PATCH', { status: 'cancelled' }),
      idParams
    );
    expect(res.status).toBe(403);
    const updates = supabaseMock.__calls.filter(
      (c) => c.table === 'commercial_documents' && c.method === 'update'
    );
    expect(updates).toHaveLength(0);
  });

  it('proveedores: un member no crea proveedores', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
    const res = await createSupplier(
      jsonRequest('http://localhost/api/suppliers', 'POST', { name: 'Proveedor X' })
    );
    expect(res.status).toBe(403);
    const inserts = supabaseMock.__calls.filter((c) => c.table === 'suppliers' && c.method === 'insert');
    expect(inserts).toHaveLength(0);
  });

  it('proveedores: un manager sí crea proveedores', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'manager' }, error: null });
    supabaseMock.__queue('suppliers', { data: null, error: null });
    supabaseMock.__queue('suppliers', { data: { id: 'sup-1', name: 'Proveedor X' }, error: null });
    supabaseMock.__queue('providers', { data: null, error: null });

    const res = await createSupplier(
      jsonRequest('http://localhost/api/suppliers', 'POST', { name: 'Proveedor X' })
    );
    expect(res.status).toBe(201);
  });

  describe('escrituras con gate de rol restantes (Fase 2)', () => {
    it('proveedores: un member no edita un proveedor', async () => {
      supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
      const res = await updateSupplier(
        jsonRequest('http://localhost/api/suppliers/sup-1', 'PATCH', { name: 'Nuevo' }),
        supplierParams
      );
      expect(res.status).toBe(403);
      const updates = supabaseMock.__calls.filter((c) => c.table === 'suppliers' && c.method === 'update');
      expect(updates).toHaveLength(0);
    });

    it('proveedores: un member no elimina un proveedor', async () => {
      supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
      const res = await deleteSupplier(
        jsonRequest('http://localhost/api/suppliers/sup-1', 'DELETE'),
        supplierParams
      );
      expect(res.status).toBe(403);
      const deletes = supabaseMock.__calls.filter((c) => c.table === 'suppliers' && c.method === 'delete');
      expect(deletes).toHaveLength(0);
    });

    it('pedidos: un member no crea pedidos de compra', async () => {
      supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
      const res = await createPurchaseOrder(
        jsonRequest('http://localhost/api/purchase-orders', 'POST', {
          supplier_id: 'sup-1',
          items: [{ product_id: 'p-1', quantity: 1 }],
        })
      );
      expect(res.status).toBe(403);
      const inserts = supabaseMock.__calls.filter((c) => c.table === 'purchase_orders' && c.method === 'insert');
      expect(inserts).toHaveLength(0);
    });

    it('pedidos: un member no modifica un pedido', async () => {
      supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
      const res = await updatePurchaseOrder(
        jsonRequest('http://localhost/api/purchase-orders/po-1', 'PATCH', { status: 'sent' }),
        poParams
      );
      expect(res.status).toBe(403);
      const updates = supabaseMock.__calls.filter((c) => c.table === 'purchase_orders' && c.method === 'update');
      expect(updates).toHaveLength(0);
    });

    it('pedidos: un member no recibe un pedido', async () => {
      supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
      const res = await receivePurchaseOrder(
        jsonRequest('http://localhost/api/purchase-orders/po-1/receive', 'POST', {}),
        poParams
      );
      expect(res.status).toBe(403);
      const mutations = supabaseMock.__calls.filter(
        (c) => c.table === 'purchase_orders' || c.table === 'product_stock'
      );
      expect(mutations).toHaveLength(0);
    });

    it('transferencias: un member no avanza una transferencia', async () => {
      supabaseMock.__queue('stock_transfers', {
        data: { id: 'tr-1', status: 'pending', from_tenant_id: 'tenant-1', to_tenant_id: 'tenant-2' },
        error: null,
      });
      supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
      const res = await updateTransferStatus(
        jsonRequest('http://localhost/api/stock-transfers/tr-1', 'PATCH', { status: 'in_transit' }),
        transferParams
      );
      expect(res.status).toBe(403);
      const updates = supabaseMock.__calls.filter((c) => c.table === 'stock_transfers' && c.method === 'update');
      expect(updates).toHaveLength(0);
    });

    it('transferencias: un member no cancela una transferencia', async () => {
      supabaseMock.__queue('stock_transfers', {
        data: { id: 'tr-1', status: 'pending', from_tenant_id: 'tenant-1', to_tenant_id: 'tenant-2' },
        error: null,
      });
      supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
      const res = await deleteTransfer(
        jsonRequest('http://localhost/api/stock-transfers/tr-1', 'DELETE'),
        transferParams
      );
      expect(res.status).toBe(403);
      const deletes = supabaseMock.__calls.filter((c) => c.table === 'stock_transfers' && c.method === 'delete');
      expect(deletes).toHaveLength(0);
    });

    it('caja: un member no cierra la caja', async () => {
      supabaseMock.__queue('tenant_users', { data: [{ role: 'member' }], error: null });
      const res = await closeCashBox(jsonRequest('http://localhost/api/cash-register/sess-1/close', 'POST', {}));
      expect(res.status).toBe(403);
      const updates = supabaseMock.__calls.filter(
        (c) => c.table === 'cash_register_sessions' && c.method === 'update'
      );
      expect(updates).toHaveLength(0);
    });

    it('caja: un member no registra movimientos', async () => {
      supabaseMock.__queue('tenant_users', { data: [{ role: 'member' }], error: null });
      const res = await recordCashMovement(
        jsonRequest('http://localhost/api/cash-register/sess-1/movements', 'POST', { type: 'in', amount: 100 })
      );
      expect(res.status).toBe(403);
      const inserts = supabaseMock.__calls.filter((c) => c.table === 'cash_movements' && c.method === 'insert');
      expect(inserts).toHaveLength(0);
    });

    it('documentos: un member no elimina un documento', async () => {
      supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
      const res = await deleteDocument(jsonRequest('http://localhost/api/documents/doc-1', 'DELETE'), idParams);
      expect(res.status).toBe(403);
      const deletes = supabaseMock.__calls.filter(
        (c) => c.table === 'commercial_documents' && c.method === 'delete'
      );
      expect(deletes).toHaveLength(0);
    });

    it('productos: un member no edita el catálogo global', async () => {
      supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
      const res = await updateProduct(
        jsonRequest('http://localhost/api/products/prod-1', 'PATCH', { price: 10 }),
        productParams
      );
      expect(res.status).toBe(403);
      const updates = supabaseMock.__calls.filter((c) => c.table === 'products' && c.method === 'update');
      expect(updates).toHaveLength(0);
    });

    it('productos: un member no ajusta precios en lote', async () => {
      supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
      const res = await adjustPrices(
        jsonRequest('http://localhost/api/products/adjust-prices', 'POST', { percentage: 10 })
      );
      expect(res.status).toBe(403);
      const updates = supabaseMock.__calls.filter((c) => c.table === 'products' && c.method === 'update');
      expect(updates).toHaveLength(0);
    });

    it('colaboradores: un member no edita colaboradores (solo owner)', async () => {
      supabaseMock.__queue('tenant_users', { data: [], error: null });
      const res = await updateCollaborator(
        jsonRequest('http://localhost/api/settings/collaborators/user-9', 'PATCH', { role: 'manager' }),
        collaboratorParams
      );
      expect(res.status).toBe(403);
    });

    it('colaboradores: un member no elimina colaboradores (solo owner)', async () => {
      supabaseMock.__queue('tenant_users', { data: [], error: null });
      const res = await deleteCollaborator(
        jsonRequest('http://localhost/api/settings/collaborators/user-9', 'DELETE'),
        collaboratorParams
      );
      expect(res.status).toBe(403);
    });

    it('productos: un member sí puede desactivar un producto (semántica documentada)', async () => {
      supabaseMock.__queue('product_stock', { data: { id: 'ps-1' }, error: null });
      supabaseMock.__queue('products', { data: { name: 'Coca' }, error: null });
      const res = await deleteProduct(jsonRequest('http://localhost/api/products/prod-1', 'DELETE'), productParams);
      expect(res.status).toBe(200);
    });

    it('productos: un member sí puede ajustar su stock (semántica documentada)', async () => {
      supabaseMock.__queue('products', { data: { id: 'prod-1', name: 'Coca' }, error: null });
      supabaseMock.__queue('product_stock', { data: { stock: 5 }, error: null });
      const res = await adjustProductStock(
        jsonRequest('http://localhost/api/products/prod-1/adjust', 'POST', { quantity: 3, reason: 'correction' }),
        productParams
      );
      expect(res.status).toBe(200);
    });

    it('onboarding: rechaza un POST cross-site (CSRF)', async () => {
      const res = await completeOnboarding(
        new Request('http://localhost/api/onboarding', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
          body: JSON.stringify({ companyName: 'Acme', ownerName: 'Ana' }),
        })
      );
      expect(res.status).toBe(403);
    });

    it('onboarding: responde 401 sin sesión ni Bearer válido', async () => {
      serverAuthMock.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null } as never);
      const res = await completeOnboarding(
        jsonRequest('http://localhost/api/onboarding', 'POST', { companyName: 'Acme', ownerName: 'Ana' })
      );
      expect(res.status).toBe(401);
    });
  });
});
