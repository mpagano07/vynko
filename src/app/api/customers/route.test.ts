import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { GET, POST } from './route';

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

function makeRequest(method: string, body?: unknown): Request {
  return new Request('http://localhost/api/customers', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('Customers API', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  describe('GET /api/customers', () => {
    it('returns 401 without auth', async () => {
      vi.mocked(getAuth).mockResolvedValueOnce(null);
      const res = await GET(makeRequest('GET'));
      expect(res.status).toBe(401);
    });

    it('lists customers for the tenant', async () => {
      supabaseMock.__queue('customers', {
        data: [{ id: 'c1', name: 'Juan Perez', tenant_id: 'tenant-1' }],
      });

      const res = await GET(makeRequest('GET'));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toHaveLength(1);
      expect(json[0].name).toBe('Juan Perez');

      const eqs = supabaseMock.__calls.filter(
        (c) => c.table === 'customers' && c.method === 'eq'
      );
      expect(eqs.length).toBeGreaterThan(0);
      expect(eqs[0].args[0]).toBe('tenant_id');
      expect(eqs[0].args[1]).toBe('tenant-1');
    });

    it('does not filter by tenant when allTenants is true', async () => {
      vi.mocked(getAuth).mockResolvedValueOnce({ ...mockAuth, allTenants: true });
      supabaseMock.__queue('customers', { data: [] });

      const res = await GET(makeRequest('GET'));
      expect(res.status).toBe(200);

      const eqs = supabaseMock.__calls.filter(
        (c) => c.table === 'customers' && c.method === 'eq'
      );
      expect(eqs).toHaveLength(0);
    });
  });

  describe('POST /api/customers', () => {
    it('returns 401 without auth', async () => {
      vi.mocked(getAuth).mockResolvedValueOnce(null);
      const res = await POST(makeRequest('POST', { name: 'Juan Perez' }));
      expect(res.status).toBe(401);
    });

    it('creates customer with valid name (201)', async () => {
      supabaseMock.__queue('customers', {
        data: { id: 'c2', name: 'Ana', tenant_id: 'tenant-1' },
      });

      const res = await POST(makeRequest('POST', { name: 'Ana', email: 'ana@ejemplo.com' }));
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.name).toBe('Ana');

      const insertCall = supabaseMock.__calls.find(
        (c) => c.table === 'customers' && c.method === 'insert'
      );
      expect(insertCall?.args[0]).toMatchObject({
        name: 'Ana',
        email: 'ana@ejemplo.com',
        tenant_id: 'tenant-1',
      });
    });

    it('rejects customer without name (400)', async () => {
      const res = await POST(makeRequest('POST', { email: 'sin-nombre@ejemplo.com' }));
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe('El nombre del cliente es requerido');
    });

    it('rejects invalid JSON body (400)', async () => {
      const req = new Request('http://localhost/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-valid-json',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid request body');
    });

    it('uses null for optional fields when omitted', async () => {
      supabaseMock.__queue('customers', {
        data: { id: 'c3', name: 'Solo Nombre', tenant_id: 'tenant-1' },
      });

      const res = await POST(makeRequest('POST', { name: 'Solo Nombre' }));
      expect(res.status).toBe(201);

      const insertCall = supabaseMock.__calls.find(
        (c) => c.table === 'customers' && c.method === 'insert'
      );
      expect(insertCall?.args[0]).toMatchObject({
        name: 'Solo Nombre',
        email: null,
        phone: null,
        address: null,
        notes: null,
      });
    });

    it('returns 400 when the insert fails', async () => {
      supabaseMock.__queue('customers', {
        data: null,
        error: { message: 'duplicate customer' },
      });

      const res = await POST(makeRequest('POST', { name: 'Juan' }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('duplicate customer');
    });
  });
});

describe('GET /api/customers error', () => {
  beforeEach(() => {
    supabaseMock.__reset();
  });

  it('returns 500 on database error', async () => {
    supabaseMock.__queue('customers', { data: null, error: { message: 'db down' } });

    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('db down');
  });
});
