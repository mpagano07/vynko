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
  return new Request('http://localhost/api/suppliers', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('Suppliers API', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
    vi.mocked(createActivityLog).mockClear();
  });

  describe('GET /api/suppliers', () => {
    it('returns 401 without auth', async () => {
      vi.mocked(getAuth).mockResolvedValueOnce(null);
      const res = await GET(makeRequest('GET'));
      expect(res.status).toBe(401);
    });

    it('lists suppliers for the tenant', async () => {
      supabaseMock.__queue('suppliers', {
        data: [{ id: 's1', name: 'Distribuidora', tenant_id: 'tenant-1' }],
      });

      const res = await GET(makeRequest('GET'));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toHaveLength(1);
      expect(json[0].name).toBe('Distribuidora');

      const eqs = supabaseMock.__calls.filter(
        (c) => c.table === 'suppliers' && c.method === 'eq'
      );
      expect(eqs.length).toBeGreaterThan(0);
      expect(eqs[0].args[0]).toBe('tenant_id');
      expect(eqs[0].args[1]).toBe('tenant-1');
    });
  });

  describe('POST /api/suppliers', () => {
    it('returns 401 without auth', async () => {
      vi.mocked(getAuth).mockResolvedValueOnce(null);
      const res = await POST(makeRequest('POST', { name: 'Distribuidora' }));
      expect(res.status).toBe(401);
    });

    it('rejects supplier without name (400)', async () => {
      const res = await POST(makeRequest('POST', { contact_name: 'Jose' }));
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe('El nombre del proveedor es requerido');
    });

    it('creates supplier and records activity log (201)', async () => {
      supabaseMock.__queue('suppliers', { data: null, error: null }); // duplicate check
      supabaseMock.__queue('suppliers', {
        data: { id: 's2', name: 'Macro', tenant_id: 'tenant-1' },
      });
      supabaseMock.__queue('providers', {
        data: { id: 's2', name: 'Macro', tenant_id: 'tenant-1' },
      });

      const res = await POST(makeRequest('POST', { name: 'Macro', phone: '123' }));
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.name).toBe('Macro');

      // Check suppliers insert
      const insertSup = supabaseMock.__calls.find(
        (c) => c.table === 'suppliers' && c.method === 'insert'
      );
      expect(insertSup?.args[0]).toMatchObject({
        name: 'Macro',
        phone: '123',
        tenant_id: 'tenant-1',
      });

      // Check providers insert
      const insertProv = supabaseMock.__calls.find(
        (c) => c.table === 'providers' && c.method === 'insert'
      );
      expect(insertProv?.args[0]).toMatchObject({
        id: 's2',
        name: 'Macro',
        tenant_id: 'tenant-1',
      });

      // Check activity log
      expect(createActivityLog).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'created',
        entityType: 'supplier',
        entityId: 's2',
        details: { name: 'Macro' },
      });
    });

    it('rejects invalid JSON body (400)', async () => {
      const req = new Request('http://localhost/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-valid-json',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid request body');
    });

    it('returns 400 when the suppliers insert fails', async () => {
      supabaseMock.__queue('suppliers', { data: null, error: null }); // duplicate check
      supabaseMock.__queue('suppliers', {
        data: null,
        error: { message: 'duplicate supplier' },
      });
      supabaseMock.__queue('providers', { data: null, error: null });

      const res = await POST(makeRequest('POST', { name: 'Macro' }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Ocurrio un error inesperado. Intenta de nuevo.');
    });

    it('returns 409 when a supplier with the same name exists for the tenant', async () => {
      supabaseMock.__queue('suppliers', {
        data: { id: 's-existing', name: 'Macro', tenant_id: 'tenant-1' },
        error: null,
      });

      const res = await POST(makeRequest('POST', { name: 'Macro' }));
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toBe('Ya existe un proveedor con ese nombre');
    });
  });
});

describe('GET /api/suppliers error', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('returns 500 on database error', async () => {
    supabaseMock.__queue('suppliers', { data: null, error: { message: 'db down' } });

    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Ocurrio un error inesperado. Intenta de nuevo.');
  });
});
