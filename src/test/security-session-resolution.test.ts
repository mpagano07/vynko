import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

const serverAuthMock = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: null as null | Record<string, unknown> }, error: null })),
  },
};

vi.mock('@/lib/supabase', () => ({
  createServerSupabaseClient: vi.fn(async () => serverAuthMock),
  hardenSessionCookieOptions: (options: Record<string, unknown>) => options,
}));

import { getSessionData } from '@/lib/session-service';

const USER_ID = 'user-1';

function sessionRequest(activeTenantId?: string): Request {
  return new Request('https://app.test/api/session', {
    headers: activeTenantId ? { 'x-active-tenant-id': activeTenantId } : {},
  });
}

/** Encola las respuestas de una llamada tipica a /api/session. */
function queueSession({ role = 'owner', onboardingPending = false, memberships }: {
  role?: string;
  onboardingPending?: boolean;
  memberships?: Record<string, unknown>[];
} = {}) {
  supabaseMock.__queue('profiles', {
    data: { id: USER_ID, full_name: 'Ada', onboarding_pending: onboardingPending },
    error: null,
  });
  supabaseMock.__queue('tenant_users', {
    data: memberships ?? [{ tenant_id: 'tenant-1', role }],
    error: null,
  });
  supabaseMock.__queue('tenants', {
    data: [{ id: 'tenant-1', name: 'Acme', slug: 'acme' }],
    error: null,
  });
}

beforeEach(() => {
  supabaseMock.__reset();
  serverAuthMock.auth.getUser.mockResolvedValue({
    data: { user: { id: USER_ID, email: 'ada@example.com' } },
    error: null,
  });
});

describe('getSessionData resuelve permisos por request', () => {
  it('el rol sale de tenant_users, no de la sesion', async () => {
    // El token de Supabase no lleva roles: el rol vive en `tenant_users` y se
    // lee en cada request. Por eso bajar o subir a alguien no necesita que cierre
    // sesion ni que espere un TTL de cache.
    queueSession({ role: 'owner' });
    const owner = await getSessionData(sessionRequest());
    expect(owner.data.role).toBe('owner');

    // Mismo usuario, misma sesion, rol cambiado en la base.
    queueSession({ role: 'member' });
    const demoted = await getSessionData(sessionRequest());
    expect(demoted.data.role).toBe('member');
  });

  it('la perdida de la ultima membresia se refleja en el request siguiente', async () => {
    queueSession({ role: 'owner' });
    await getSessionData(sessionRequest());
    expect(supabaseMock.__calls.filter((c) => c.table === 'tenant_users')).not.toHaveLength(0);

    supabaseMock.__reset();
    // Sin membresias: no hay empresa, no hay rol, y el onboarding vuelve a
    // corresponder. La sesion sigue viva: la app decide que hacer con esto en el
    // guard de cliente, no expulsando desde el servidor.
    supabaseMock.__queue('profiles', {
      data: { id: USER_ID, full_name: 'Ada', onboarding_pending: true },
      error: null,
    });
    supabaseMock.__queue('tenant_users', { data: [], error: null });

    const result = await getSessionData(sessionRequest());

    expect(result.data.role).toBeNull();
    expect(result.data.tenant).toBeNull();
    expect(result.data.tenants).toEqual([]);
    expect(result.data.onboarding_pending).toBe(true);
  });

  it('respeta x-active-tenant-id para elegir el tenant, no el rol global', async () => {
    // Un usuario en dos companies puede estar owner en una y member en otra. El
    // rol devuelto es el del tenant activo.
    supabaseMock.__queue('profiles', {
      data: { id: USER_ID, onboarding_pending: false },
      error: null,
    });
    supabaseMock.__queue('tenant_users', {
      data: [
        { tenant_id: 'tenant-1', role: 'owner' },
        { tenant_id: 'tenant-2', role: 'member' },
      ],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: [
        { id: 'tenant-1', name: 'Acme', slug: 'acme' },
        { id: 'tenant-2', name: 'Globex', slug: 'globex' },
      ],
      error: null,
    });

    const asOwner = await getSessionData(sessionRequest('tenant-1'));
    expect(asOwner.data.role).toBe('owner');

    supabaseMock.__reset();
    supabaseMock.__queue('profiles', {
      data: { id: USER_ID, onboarding_pending: false },
      error: null,
    });
    supabaseMock.__queue('tenant_users', {
      data: [
        { tenant_id: 'tenant-1', role: 'owner' },
        { tenant_id: 'tenant-2', role: 'member' },
      ],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: [
        { id: 'tenant-1', name: 'Acme', slug: 'acme' },
        { id: 'tenant-2', name: 'Globex', slug: 'globex' },
      ],
      error: null,
    });

    const asMember = await getSessionData(sessionRequest('tenant-2'));
    expect(asMember.data.role).toBe('member');
  });

  it('ignora un x-active-tenant-id de un tenant que no le pertenece', async () => {
    // Elegir el tenant activo no puede ser un vector de escalada: si el id no
    // esta en las membresias del usuario, se cae al primero.
    supabaseMock.__queue('profiles', {
      data: { id: USER_ID, onboarding_pending: false },
      error: null,
    });
    supabaseMock.__queue('tenant_users', {
      data: [{ tenant_id: 'tenant-1', role: 'member' }],
      error: null,
    });
    supabaseMock.__queue('tenants', {
      data: [{ id: 'tenant-1', name: 'Acme', slug: 'acme' }],
      error: null,
    });

    const result = await getSessionData(sessionRequest('tenant-victima'));

    expect(result.data.role).toBe('member');
    // `tenant` viene como `Record<string, unknown>`, asi que el id se lee del
    // objeto y no como propiedad tipada.
    expect((result.data.tenant as { id?: string } | null)?.id).toBe('tenant-1');
  });

  it('devuelve payload anon sin tocar la base si no hay sesion', async () => {
    serverAuthMock.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'no' } as unknown as null,
    });

    const result = await getSessionData(sessionRequest());

    expect(result.data.user).toBeNull();
    expect(result.data.profile).toBeNull();
    expect(result.data.role).toBeNull();
    expect(supabaseMock.__calls).toHaveLength(0);
  });
});
