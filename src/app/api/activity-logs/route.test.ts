import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { GET } from './route';

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

function makeRequest(): Request {
  return new Request('http://localhost/api/activity-logs');
}

describe('GET /api/activity-logs', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Not authenticated');
  });

  it('devuelve 403 para member', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ role: 'member' }],
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('No tienes permisos');
  });

  it('devuelve 200 para manager', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ role: 'manager' }],
    });
    supabaseMock.__queue('activity_logs', {
      data: [
        { id: 'log-1', action: 'create', entity_type: 'product', created_at: '2026-08-19T10:00:00Z' },
      ],
      count: 1,
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.total).toBe(1);
  });

  it('devuelve 200 para owner', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ role: 'owner' }],
    });
    supabaseMock.__queue('activity_logs', {
      data: [
        { id: 'log-1', action: 'update', entity_type: 'sale', created_at: '2026-08-19T11:00:00Z' },
        { id: 'log-2', action: 'delete', entity_type: 'product', created_at: '2026-08-19T12:00:00Z' },
      ],
      count: 2,
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.total).toBe(2);
  });

  it('devuelve datos vacíos cuando no hay logs', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ role: 'owner' }],
    });
    supabaseMock.__queue('activity_logs', {
      data: [],
      count: 0,
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
    expect(json.total).toBe(0);
  });

  it('filtra por entity_type cuando se proporciona', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ role: 'owner' }],
    });
    supabaseMock.__queue('activity_logs', {
      data: [{ id: 'log-1', action: 'create', entity_type: 'product' }],
      count: 1,
    });

    const req = new Request('http://localhost/api/activity-logs?entity_type=product');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const entityCall = supabaseMock.__calls.find(
      (c) => c.table === 'activity_logs' && c.method === 'eq' && c.args[0] === 'entity_type'
    );
    expect(entityCall).toBeDefined();
  });
});
