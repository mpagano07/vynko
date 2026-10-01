import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { PATCH } from './route';

const mockAuth = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  allTenants: false,
  tenantIds: ['tenant-1'],
};

vi.mock('@/lib/api-auth', () => ({ getAuth: vi.fn(async () => mockAuth) }));
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/onboarding/checklist', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function updateCall() {
  const call = supabaseMock.__calls.find((c) => c.method === 'update');
  if (!call) throw new Error('no se hizo update');
  return call;
}

describe('PATCH /api/onboarding/checklist', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin sesion y no escribe nada', async () => {
    vi.mocked(getAuth).mockResolvedValue(null);
    const res = await PATCH(makeRequest({ dismissed: true }));
    expect(res.status).toBe(401);
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('marca la preferencia sobre el perfil del usuario autenticado', async () => {
    const res = await PATCH(makeRequest({ dismissed: true }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ dismissed: true });

    const call = updateCall();
    expect(call.table).toBe('profiles');
    expect(call.args[0]).toMatchObject({ onboarding_checklist_dismissed_at: expect.any(String) });
    // `.eq('id', auth.userId)`: si se cae esa parte se puede cambiar la
    // preferencia de otro usuario.
    const eq = supabaseMock.__calls.find((c) => c.method === 'eq');
    expect(eq?.args).toEqual(['id', 'user-1']);
  });

  it('limpia la preferencia cuando dismissed es false', async () => {
    const res = await PATCH(makeRequest({ dismissed: false }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ dismissed: false });
    expect(updateCall().args[0]).toEqual({ onboarding_checklist_dismissed_at: null });
  });

  it('rechaza un dismissed que no sea boolean', async () => {
    for (const dismissed of ['true', 1, null, undefined]) {
      const res = await PATCH(makeRequest({ dismissed }));
      expect(res.status).toBe(400);
    }
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('rechaza un cuerpo que no es JSON', async () => {
    const res = await PATCH(
      new Request('http://localhost/api/onboarding/checklist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'no-json',
      })
    );
    expect(res.status).toBe(400);
  });

  it('devuelve 500 si falla la escritura', async () => {
    supabaseMock.__queue('profiles', { data: null, error: { message: 'boom' } });
    const res = await PATCH(makeRequest({ dismissed: true }));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'boom' });
  });
});