import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { POST } from './route';
import { createActivityLog } from '@/lib/activity-log';

const mockAuth = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  allTenants: false,
  tenantIds: ['tenant-1'],
};

vi.mock('@/lib/api-auth', () => ({
  getAuth: vi.fn(async () => mockAuth),
}));

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

vi.mock('@/lib/activity-log', () => ({
  createActivityLog: vi.fn(),
}));

function makeRequest(method: string, body?: unknown): Request {
  return new Request('http://localhost/api/stock-transfers', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('Stock Transfers API', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
    vi.mocked(createActivityLog).mockClear();
  });

  describe('POST /api/stock-transfers', () => {
    it('returns 401 without auth', async () => {
      vi.mocked(getAuth).mockResolvedValueOnce(null);
      const res = await POST(makeRequest('POST', { from_tenant_id: 't1', to_tenant_id: 't2' }));
      expect(res.status).toBe(401);
    });

    it('rejects without origin or destination (400)', async () => {
      const res = await POST(makeRequest('POST', { from_tenant_id: 't1' }));
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe('Origen y destino son requeridos');
    });

    it('rejects when origin === destination (400)', async () => {
      const res = await POST(makeRequest('POST', { from_tenant_id: 't1', to_tenant_id: 't1' }));
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe('Origen y destino deben ser diferentes');
    });

    it('rejects without items (400)', async () => {
      const res = await POST(makeRequest('POST', { from_tenant_id: 't1', to_tenant_id: 't2', items: [] }));
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe('Debe incluir al menos un producto');
    });

    it('creates transfer with valid data (201) and records activity log', async () => {
      supabaseMock.__queue('stock_transfers', {
        data: { id: 'tr1', from_tenant_id: 't1', to_tenant_id: 't2', status: 'pending' },
      });
      supabaseMock.__queue('stock_transfer_items', { data: null, error: null });

      const res = await POST(makeRequest('POST', {
        from_tenant_id: 't1',
        to_tenant_id: 't2',
        items: [{ product_id: 'p1', quantity: 5 }]
      }));
      expect(res.status).toBe(201);

      const transferInsert = supabaseMock.__calls.find(
        (c) => c.table === 'stock_transfers' && c.method === 'insert'
      );
      expect(transferInsert?.args[0]).toMatchObject({
        from_tenant_id: 't1',
        to_tenant_id: 't2',
        status: 'pending',
      });

      const itemsInsert = supabaseMock.__calls.find(
        (c) => c.table === 'stock_transfer_items' && c.method === 'insert'
      );
      expect(itemsInsert?.args[0]).toEqual([
        { transfer_id: 'tr1', product_id: 'p1', quantity: 5 }
      ]);

      expect(createActivityLog).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'created',
        entityType: 'stock_transfer',
        entityId: 'tr1',
        details: { from_tenant_id: 't1', to_tenant_id: 't2', items_count: 1 },
      });
    });

    it('cleans up transfer if items insert fails', async () => {
      supabaseMock.__queue('stock_transfers', {
        data: { id: 'tr1', from_tenant_id: 't1', to_tenant_id: 't2', status: 'pending' },
      });
      supabaseMock.__queue('stock_transfer_items', {
        data: null, error: { message: 'DB Error' }
      });
      supabaseMock.__queue('stock_transfers', { data: null, error: null }); // For delete

      const res = await POST(makeRequest('POST', {
        from_tenant_id: 't1',
        to_tenant_id: 't2',
        items: [{ product_id: 'p1', quantity: 5 }]
      }));
      expect(res.status).toBe(400);

      const deleteCall = supabaseMock.__calls.find(
        (c) => c.table === 'stock_transfers' && c.method === 'delete'
      );
      expect(deleteCall).toBeDefined();

      const eqCall = supabaseMock.__calls.find(
        (c) => c.table === 'stock_transfers' && c.method === 'eq'
      );
      expect(eqCall?.args[0]).toBe('id');
      expect(eqCall?.args[1]).toBe('tr1');
    });
  });
});
