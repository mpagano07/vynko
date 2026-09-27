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
import { PATCH as updateDocument } from '@/app/api/documents/[id]/route';
import { POST as createSupplier } from '@/app/api/suppliers/route';

const idParams = { params: Promise.resolve({ id: 'doc-1' }) } as never;

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
});
