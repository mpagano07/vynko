import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { GET, PUT } from './route';

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

function makeRequest(url: string, body?: unknown): Request {
  return new Request(url, {
    method: body ? 'PUT' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('/api/settings/checkout', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve la configuración de cobro con valores por defecto', async () => {
    supabaseMock.__queue('tenants', { data: { settings: { checkout: { payment_adjustments: { cash: -5 } } } } });
    supabaseMock.__queue('tenant_users', { data: [{ role: 'owner' }] });

    const res = await GET(makeRequest('http://localhost/api/settings/checkout'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.checkout.payment_adjustments.cash).toBe(-5);
    expect(json.checkout.paper_size).toBe('58mm');
    expect(json.canEdit).toBe(true);
  });

  it('marca canEdit=false para un miembro', async () => {
    supabaseMock.__queue('tenants', { data: undefined });
    supabaseMock.__queue('tenant_users', { data: [{ role: 'member' }] });

    const res = await GET(makeRequest('http://localhost/api/settings/checkout'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.canEdit).toBe(false);
  });

  it('guarda la configuración de cobro y conserva el resto del settings', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ role: 'owner' }] });
    supabaseMock.__queue('tenants', { data: { settings: { modules: { inventory: true } } } });
    supabaseMock.__queue('tenants', { data: null, error: null });

    const res = await PUT(
      makeRequest('http://localhost/api/settings/checkout', {
        payment_adjustments: { cash: -10, transfer: 0, debit: 0, credit: 5, mercadopago: 0 },
        paper_size: '80mm',
        show_receipt: true,
      })
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.saved).toBe(true);

    const update = supabaseMock.__calls.find((c) => c.table === 'tenants' && c.method === 'update');
    const updatedSettings = (update?.args[0] ?? {}) as { settings?: Record<string, unknown> };
    expect(updatedSettings.settings?.modules).toEqual({ inventory: true });
    expect(
      (updatedSettings.settings?.checkout as Record<string, unknown> | undefined)?.payment_adjustments as Record<string, unknown>
    ).toMatchObject({ credit: 5 });
    expect((updatedSettings.settings?.checkout as Record<string, unknown> | undefined)?.paper_size).toBe('80mm');
  });

  it('rechaza a un miembro sin permisos', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ role: 'member' }] });

    const res = await PUT(makeRequest('http://localhost/api/settings/checkout', { payment_adjustments: {} }));
    expect(res.status).toBe(403);
  });
});