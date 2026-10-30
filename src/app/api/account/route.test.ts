import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { DELETE } from './route';

const mockAuth = { tenantId: 'tenant-1', userId: 'user-1', allTenants: false, tenantIds: ['tenant-1'] };

vi.mock('@/lib/api-auth', () => ({ getAuth: vi.fn(async () => mockAuth) }));
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));
vi.mock('@/lib/account-subscriptions', () => ({
  cancelAccountSubscriptions: vi.fn(async () => ({
    ok: true,
    data: {
      canceledPaddleSubscriptions: 0,
      canceledMercadoPagoPreapprovals: 0,
      canceledPaddleTransactions: 0,
    },
  })),
}));
vi.mock('@/lib/upload-service', () => ({
  deleteTenantProductImages: vi.fn(async () => ({ ok: true, deleted: 0 })),
}));
vi.mock('@/lib/google/token-store', () => ({
  revokeGoogleDriveConnection: vi.fn(async () => undefined),
}));

function makeRequest(body?: unknown): Request {
  return new Request('http://localhost/api/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('DELETE /api/account', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await DELETE(makeRequest({ confirm: 'ELIMINAR' }));
    expect(res.status).toBe(401);
  });

  it('devuelve 400 si falta la confirmación', async () => {
    const res = await DELETE(makeRequest({ confirm: 'no' }));
    expect(res.status).toBe(400);
  });

  it('devuelve 400 ante un body inválido', async () => {
    const req = new Request('http://localhost/api/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it('elimina la cuenta y responde 200', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1', role: 'owner' }] });
    supabaseMock.__queue('tenants', { data: null, error: null });
    supabaseMock.__queue('tenant_users', { data: null, error: null });

    const res = await DELETE(makeRequest({ confirm: 'ELIMINAR' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(true);
  });
});
