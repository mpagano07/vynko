import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { GET, POST } from './route';
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

    it('returns 400 when the transfer could not be created without an error message', async () => {
      supabaseMock.__queue('stock_transfers', { data: null, error: null });

      const res = await POST(makeRequest('POST', {
        from_tenant_id: 't1',
        to_tenant_id: 't2',
        items: [{ product_id: 'p1', quantity: 5 }]
      }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Error al crear transferencia');
    });
  });

  describe('GET /api/stock-transfers', () => {
    beforeEach(() => {
      supabaseMock.__reset();
      vi.mocked(getAuth).mockResolvedValue(mockAuth);
    });

    function makeGetRequest(query = ''): Request {
      return new Request(`http://localhost/api/stock-transfers${query}`, { method: 'GET' });
    }

    it('returns 401 without auth', async () => {
      vi.mocked(getAuth).mockResolvedValueOnce(null);
      const res = await GET(makeGetRequest());
      expect(res.status).toBe(401);
    });

    it('filtra por tenant y traduce nombres de sucursales/usuarios/productos', async () => {
      supabaseMock.__queue('stock_transfers', {
        data: [
          {
            id: 'tr1',
            from_tenant_id: 't1',
            to_tenant_id: 't2',
            created_by: 'user-1',
            items: [
              { id: 'i1', product: { name: 'Coca' } },
              { id: 'i2', product: null },
            ],
          },
        ],
      });
      supabaseMock.__queue('tenants', {
        data: [
          { id: 't1', name: 'Central' },
          { id: 't2', name: 'Norte' },
        ],
      });
      supabaseMock.__queue('profiles', { data: [{ id: 'user-1', full_name: 'Ana' }] });

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json[0]).toMatchObject({
        from_tenant_name: 'Central',
        to_tenant_name: 'Norte',
        created_by_name: 'Ana',
      });
      expect(json[0].items[0].product_name).toBe('Coca');
      expect(json[0].items[1].product_name).toBeNull();

      const orCall = supabaseMock.__calls.find((c) => c.method === 'or');
      expect(orCall?.args[0]).toBe('from_tenant_id.eq.tenant-1,to_tenant_id.eq.tenant-1');
    });

    it('aplica el filtro de estado y no usa or() para allTenants', async () => {
      vi.mocked(getAuth).mockResolvedValueOnce({ ...mockAuth, allTenants: true });
      supabaseMock.__queue('stock_transfers', { data: [] });

      const res = await GET(makeGetRequest('?status=completed'));
      expect(res.status).toBe(200);

      const orCall = supabaseMock.__calls.find((c) => c.method === 'or');
      expect(orCall).toBeUndefined();
      const statusEq = supabaseMock.__calls.find(
        (c) => c.table === 'stock_transfers' && c.method === 'eq' && c.args[0] === 'status'
      );
      expect(statusEq?.args[1]).toBe('completed');
    });

    it('aplica el filtro de estado para una sucursal individual', async () => {
      supabaseMock.__queue('stock_transfers', { data: [] });

      const res = await GET(makeGetRequest('?status=pending'));
      expect(res.status).toBe(200);

      const orCall = supabaseMock.__calls.find((c) => c.method === 'or');
      expect(orCall).toBeDefined();
      const statusEq = supabaseMock.__calls.find(
        (c) => c.table === 'stock_transfers' && c.method === 'eq' && c.args[0] === 'status'
      );
      expect(statusEq?.args[1]).toBe('pending');
    });

    it('usa nombres de fallback cuando faltan datos de sucursal/usuario', async () => {
      supabaseMock.__queue('stock_transfers', {
        data: [
          { id: 'tr1', from_tenant_id: 't1', to_tenant_id: 't2', created_by: 'user-1' },
        ],
      });
      supabaseMock.__queue('tenants', { data: [] });
      supabaseMock.__queue('profiles', { data: [] });

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json[0]).toMatchObject({
        from_tenant_name: 'Desconocido',
        to_tenant_name: 'Desconocido',
        created_by_name: 'Usuario',
      });
    });

    it('devuelve 500 ante un error de base de datos', async () => {
      supabaseMock.__queue('stock_transfers', { data: null, error: { message: 'db down' } });

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('db down');
    });
  });
});
