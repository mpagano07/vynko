import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { LAST_SEEN_COOKIE } from '@/lib/session-policy';

const { acceptInvitationsForUser, getUserTenantIds, createCompanyForUser, exchangeCodeForSession } = vi.hoisted(() => ({
  acceptInvitationsForUser: vi.fn(async () => ({ accepted: 1 })),
  getUserTenantIds: vi.fn(async () => ['tenant-1']),
  createCompanyForUser: vi.fn(async () => 'tenant-1'),
  exchangeCodeForSession: vi.fn(async () => ({
    data: { session: { access_token: 'x' }, user: { id: 'user-1', email: 'nuevo@tienda.com' } },
    error: null,
  })),
}));

vi.mock('@/lib/supabase', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession },
  })),
}));

vi.mock('@/lib/accept-invitations', () => ({
  acceptInvitationsForUser,
  getUserTenantIds,
}));

vi.mock('@/lib/create-company', () => ({
  createCompanyForUser,
}));

function callback(params: string): Request {
  return new Request(`http://localhost:3000/auth/callback?${params}`);
}

describe('GET /auth/callback', () => {
  beforeEach(() => {
    acceptInvitationsForUser.mockClear();
    getUserTenantIds.mockClear();
    createCompanyForUser.mockClear();
    exchangeCodeForSession.mockClear();
  });

  it('acepta las invitaciones pendientes en el callback normal', async () => {
    const res = await GET(callback('code=abc'));

    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(acceptInvitationsForUser).toHaveBeenCalledWith({ id: 'user-1', email: 'nuevo@tienda.com' });
    expect(res.headers.get('location')).toContain('/dashboard');
    expect(res.cookies.get(LAST_SEEN_COOKIE)?.value).toBeTruthy();
  });

  it('deja la aceptación para /accept-invite cuando el link viene de una invitación', async () => {
    const res = await GET(callback('code=abc&next=%2Faccept-invite'));

    // El canje de la sesión sí ocurre: sin sesión la página no puede aceptar.
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    // Pero aceptar acá dejaría `accepted = 0` en la página y saltearía el
    // formulario de nombre y contraseña.
    expect(acceptInvitationsForUser).not.toHaveBeenCalled();
    expect(getUserTenantIds).not.toHaveBeenCalled();
    expect(createCompanyForUser).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toContain('/accept-invite');
  });

  it('deriva a /auth/magic cuando el link no trae code (flujo implícito)', async () => {
    // Los emails de invitación y magic link entregan la sesión en el fragmento,
    // que el servidor no recibe. Sin esta derivación la request caía acá con
    // `code=null` y se la trataba como error.
    const res = await GET(callback('next=%2Faccept-invite'));

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/auth/magic?next=%2Faccept-invite'
    );
  });

  it('deriva a /auth/magic sin next cuando el link viejo no lo traía', async () => {
    const res = await GET(callback(''));

    expect(res.headers.get('location')).toBe('http://localhost:3000/auth/magic');
  });
});
