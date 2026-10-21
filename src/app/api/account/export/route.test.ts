import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { GET } from './route';

const mockAuth = { tenantId: 'tenant-1', userId: 'user-1', allTenants: false, tenantIds: ['tenant-1'] };

vi.mock('@/lib/api-auth', () => ({ getAuth: vi.fn(async () => mockAuth) }));
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));

function makeRequest(): Request {
  return new Request('http://localhost/api/account/export', { method: 'GET' });
}

describe('GET /api/account/export', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('devuelve un JSON descargable con los datos de la cuenta', async () => {
    supabaseMock.__queue('profiles', { data: { id: 'user-1', full_name: 'Ana' } });
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1', role: 'owner' }] });
    supabaseMock.__queue('tenants', { data: [{ id: 'tenant-1', name: 'Central' }] });
    for (const table of [
      'products', 'product_stock', 'categories', 'suppliers', 'providers', 'customers',
      'sales', 'sale_items', 'sale_payments', 'cash_register_sessions', 'cash_movements',
      'commercial_documents', 'commercial_document_items', 'purchase_orders',
      'purchase_order_items', 'stock_movements', 'stock_history', 'stock_transfers',
      'stock_transfer_items', 'activity_logs',
    ]) {
      supabaseMock.__queue(table, { data: [] });
    }

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain('.json');

    const json = await res.json();
    expect(json.account.profile).toMatchObject({ full_name: 'Ana' });
  });
});
