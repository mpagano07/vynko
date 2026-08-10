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

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

function makeRequest(method: string, body?: unknown): Request {
  return new Request('http://localhost/api/settings/collaborators', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/settings/collaborators', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(401);
  });

  it('bloquea a quien no es owner', async () => {
    supabaseMock.__queue('tenant_users', { data: [] });

    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Only owners can manage collaborators');
  });

  it('lista colaboradores e invitaciones pendientes para un owner', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', user_id: 'user-1' }],
    });
    supabaseMock.__queue('tenant_users', {
      data: [
        { id: 'tu1', user_id: 'user-1', role: 'owner', joined_at: '2026-01-01', tenant_id: 'tenant-1' },
        { id: 'tu2', user_id: 'user-2', role: 'member', joined_at: '2026-02-01', tenant_id: 'tenant-1' },
      ],
    });
    supabaseMock.__queue('profiles', {
      data: [
        { id: 'user-1', email: 'owner@tienda.com', full_name: 'Dueño', avatar_url: null },
        { id: 'user-2', email: 'empleado@tienda.com', full_name: 'Empleado', avatar_url: null },
      ],
    });
    supabaseMock.__queue('tenants', { data: [{ id: 'tenant-1', name: 'Sucursal Central' }] });
    supabaseMock.__queue('invitations', {
      data: [{ id: 'inv1', email: 'nuevo@tienda.com', role: 'member', created_at: '2026-03-01' }],
    });

    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.collaborators).toHaveLength(2);
    expect(json.collaborators[0].role).toBe('owner');
    expect(json.collaborators[1]).toMatchObject({ role: 'member', email: 'empleado@tienda.com' });
    expect(json.pendingInvitations).toEqual([
      expect.objectContaining({ id: 'inv1', role: 'member' }),
    ]);
  });
});

describe('POST /api/settings/collaborators', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await POST(makeRequest('POST', { email: 'a@b.com' }));
    expect(res.status).toBe(401);
  });

  it('bloquea a quien no es owner', async () => {
    supabaseMock.__queue('tenant_users', { data: [] });

    const res = await POST(makeRequest('POST', { email: 'a@b.com' }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Only owners can manage collaborators');
  });

  it('exige un email válido', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1' }] });

    const res = await POST(makeRequest('POST', { role: 'member' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Email is required');
  });

  it('agrega a un usuario ya registrado como miembro', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1' }] });
    supabaseMock.__queue('profiles', { data: { id: 'user-2', email: 'a@b.com' } });
    supabaseMock.__queue('tenant_users', { data: null, error: null });
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });
    supabaseMock.__queue('tenant_users', { data: null, error: null, count: 1 });
    supabaseMock.__queue('tenant_users', { data: null, error: null });
    supabaseMock.__queue('profiles', {
      data: { email: 'a@b.com', full_name: '', avatar_url: null },
    });

    const res = await POST(makeRequest('POST', { email: 'a@b.com', role: 'member' }));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.collaborator).toMatchObject({ user_id: 'user-2', role: 'member' });

    const insert = supabaseMock.__calls.find(
      (c) => c.table === 'tenant_users' && c.method === 'insert'
    );
    expect(insert?.args[0]).toMatchObject({ tenant_id: 'tenant-1', user_id: 'user-2', role: 'member' });
  });

  it('invita por email a un usuario nuevo', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1' }] });
    supabaseMock.__queue('profiles', { data: null, error: null });
    supabaseMock.__queue('profiles', { data: null, error: null });
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });
    supabaseMock.__queue('tenant_users', { data: null, error: null, count: 1 });
    supabaseMock.__queue('invitations', { data: null, error: null });

    const res = await POST(makeRequest('POST', { email: 'nuevo@tienda.com', role: 'member' }));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.invited).toBe(true);
    expect(json.email).toBe('nuevo@tienda.com');

    expect(supabaseMock.auth.admin.inviteUserByEmail).toHaveBeenCalledWith(
      'nuevo@tienda.com',
      expect.objectContaining({ redirectTo: expect.stringContaining('/accept-invite') })
    );

    const upsert = supabaseMock.__calls.find(
      (c) => c.table === 'invitations' && c.method === 'upsert'
    );
    expect(upsert?.args[0]).toMatchObject({ email: 'nuevo@tienda.com', role: 'member' });
  });

  it('respeta el límite de usuarios del plan', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 'tenant-1' }] });
    supabaseMock.__queue('profiles', { data: { id: 'user-2', email: 'a@b.com' } });
    supabaseMock.__queue('tenant_users', { data: null, error: null });
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'starter' } });
    supabaseMock.__queue('tenant_users', { data: null, error: null, count: 1 });

    const res = await POST(makeRequest('POST', { email: 'a@b.com', role: 'member' }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('permite hasta 1 usuario');
  });
});
