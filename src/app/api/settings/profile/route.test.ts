import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { PATCH } from './route';

const mockUser = { id: 'user-1', email: 'a@b.com' };

vi.mock('@/lib/supabase', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mockUser }, error: null })),
    },
  })),
}));

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/settings/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/settings/profile', () => {
  beforeEach(() => {
    supabaseMock.__reset();
  });

  it('rechaza un PATCH cross-site (403) sin tocar la base', async () => {
    const res = await PATCH(
      makeRequest({ full_name: 'Ana' }, { 'sec-fetch-site': 'cross-site' })
    );

    expect(res.status).toBe(403);
    expect(
      supabaseMock.__calls.some((c) => c.table === 'profiles' && c.method === 'upsert')
    ).toBe(false);
  });

  it('rechaza un Origin ajeno (403)', async () => {
    const res = await PATCH(
      makeRequest({ full_name: 'Ana' }, { origin: 'https://evil.test', host: 'localhost' })
    );

    expect(res.status).toBe(403);
  });

  it('actualiza el perfil en un PATCH same-origin', async () => {
    supabaseMock.__queue('tenant_users', { data: { tenant_id: 'tenant-1' }, error: null });
    supabaseMock.__queue('profiles', {
      data: { id: 'user-1', full_name: 'Ana', email: 'a@b.com' },
      error: null,
    });

    const res = await PATCH(
      makeRequest({ full_name: 'Ana' }, { origin: 'http://localhost', host: 'localhost' })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.profile).toMatchObject({ full_name: 'Ana' });
  });
});
