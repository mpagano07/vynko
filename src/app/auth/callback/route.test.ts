import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

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
});
