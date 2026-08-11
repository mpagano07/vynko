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
  return new Request('http://localhost/api/categories', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('Categories API', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  describe('GET /api/categories', () => {
    it('returns 401 without auth', async () => {
      vi.mocked(getAuth).mockResolvedValueOnce(null);
      const res = await GET(makeRequest('GET'));
      expect(res.status).toBe(401);
    });

    it('lists categories for the tenant', async () => {
      supabaseMock.__queue('categories', {
        data: [{ id: 'c1', name: 'Gaseosas', tenant_id: 'tenant-1' }],
      });

      const res = await GET(makeRequest('GET'));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toHaveLength(1);
      expect(json[0].name).toBe('Gaseosas');

      const categoryEqs = supabaseMock.__calls.filter(
        (c) => c.table === 'categories' && c.method === 'eq'
      );
      expect(categoryEqs.length).toBeGreaterThan(0);
      expect(categoryEqs[0].args[0]).toBe('tenant_id');
      expect(categoryEqs[0].args[1]).toBe('tenant-1');
    });

    it('does not filter by tenant when allTenants is true', async () => {
      vi.mocked(getAuth).mockResolvedValueOnce({ ...mockAuth, allTenants: true });
      supabaseMock.__queue('categories', { data: [] });

      const res = await GET(makeRequest('GET'));
      expect(res.status).toBe(200);

      const categoryEqs = supabaseMock.__calls.filter(
        (c) => c.table === 'categories' && c.method === 'eq'
      );
      expect(categoryEqs).toHaveLength(0);
    });
  });

  describe('POST /api/categories', () => {
    it('returns 401 without auth', async () => {
      vi.mocked(getAuth).mockResolvedValueOnce(null);
      const res = await POST(makeRequest('POST', { name: 'Golosinas' }));
      expect(res.status).toBe(401);
    });

    it('creates category with valid name (201)', async () => {
      supabaseMock.__queue('categories', {
        data: { id: 'c2', name: 'Golosinas', tenant_id: 'tenant-1' },
      });

      const res = await POST(makeRequest('POST', { name: 'Golosinas', description: 'Dulces' }));
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.name).toBe('Golosinas');

      const insertCall = supabaseMock.__calls.find(
        (c) => c.table === 'categories' && c.method === 'insert'
      );
      expect(insertCall?.args[0]).toMatchObject({
        name: 'Golosinas',
        description: 'Dulces',
        tenant_id: 'tenant-1',
      });
    });

    it('rejects category without name (400)', async () => {
      const res = await POST(makeRequest('POST', { description: 'Dulces' }));
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBe('El nombre de la categoría es requerido');
    });
  });
});
