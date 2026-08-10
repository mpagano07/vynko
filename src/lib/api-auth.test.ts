import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';

const supabaseAuthMock = {
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: null as null | Record<string, unknown> },
      error: null as null | Record<string, unknown>,
    })),
  },
};

vi.mock('@/lib/supabase', () => ({
  createServerSupabaseClient: vi.fn(async () => supabaseAuthMock),
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

import { getAuth } from './api-auth';

function makeRequest(header?: string): Request | undefined {
  if (!header) return undefined;
  return new Request('http://localhost/api/x', {
    headers: { 'x-active-tenant-id': header },
  });
}

describe('getAuth', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(supabaseAuthMock.auth.getUser).mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
  });

  it('devuelve null sin usuario autenticado', async () => {
    vi.mocked(supabaseAuthMock.auth.getUser).mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });
    const auth = await getAuth(makeRequest());
    expect(auth).toBeNull();
  });

  it('devuelve null si el usuario no pertenece a ningún tenant', async () => {
    supabaseMock.__queue('tenant_users', { data: [] });
    const auth = await getAuth(makeRequest());
    expect(auth).toBeNull();
  });

  it('usa la primera sucursal por defecto (usuario con una sucursal)', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: 't1', user_id: 'user-1' }] });
    const auth = await getAuth(makeRequest());
    expect(auth).toMatchObject({ tenantId: 't1', allTenants: false, tenantIds: ['t1'] });
  });

  it('selecciona la sucursal indicada por x-active-tenant-id', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [
        { tenant_id: 't1', user_id: 'user-1' },
        { tenant_id: 't2', user_id: 'user-1' },
      ],
    });
    const auth = await getAuth(makeRequest('t2'));
    expect(auth?.tenantId).toBe('t2');
    expect(auth?.allTenants).toBe(false);
    expect(auth?.tenantIds).toEqual(['t1', 't2']);
  });

  it('marca allTenants cuando la sucursal activa es __all__', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [
        { tenant_id: 't1', user_id: 'user-1' },
        { tenant_id: 't2', user_id: 'user-1' },
      ],
    });
    const auth = await getAuth(makeRequest('__all__'));
    expect(auth?.allTenants).toBe(true);
    expect(auth?.tenantId).toBe('t1');
  });

  it('ignora una sucursal activa a la que el usuario no pertenece', async () => {
    supabaseMock.__queue('tenant_users', {
      data: [
        { tenant_id: 't1', user_id: 'user-1' },
        { tenant_id: 't2', user_id: 'user-1' },
      ],
    });
    const auth = await getAuth(makeRequest('t3'));
    expect(auth?.tenantId).toBe('t1');
  });
});
