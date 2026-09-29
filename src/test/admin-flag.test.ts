import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { isAdminProfile } from '@/lib/admin';

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

const analyticsMock = { getAdminAnalytics: vi.fn(async () => ({ data: { totalSignups: 0 } })) };

vi.mock('@/lib/analytics-service', () => ({
  getAdminAnalytics: (...args: unknown[]) => analyticsMock.getAdminAnalytics(...(args as [])),
}));

import { GET as getAdminAnalyticsRoute } from '@/app/api/admin/analytics/route';

beforeEach(() => {
  supabaseMock.__reset();
  serverAuthMock.auth.getUser.mockResolvedValue({
    data: { user: { id: 'u1', email: 'user@example.com' } },
    error: null,
  });
  analyticsMock.getAdminAnalytics.mockResolvedValue({ data: { totalSignups: 7 } });
});

describe('isAdminProfile', () => {
  it('solo acepta un booleano true explicito', () => {
    // El caso `undefined` no es teorico: durante el rollout, o en un entorno sin
    // la migration 038 aplicada, la columna no existe y el valor llega
    // undefined. Un chequeo truthy (o `if (profile.is_admin)`) dejaria pasar a
    // cualquiera con otro campo truthy.
    expect(isAdminProfile({ is_admin: true })).toBe(true);
    expect(isAdminProfile({ is_admin: false })).toBe(false);
    expect(isAdminProfile({})).toBe(false);
    expect(isAdminProfile(null)).toBe(false);
    expect(isAdminProfile(undefined)).toBe(false);
    expect(isAdminProfile({ is_admin: null })).toBe(false);
  });
});

describe('GET /api/admin/analytics', () => {
  it('niega el acceso a un usuario sin el flag', async () => {
    supabaseMock.__queue('profiles', { data: { is_admin: false }, error: null });

    const response = await getAdminAnalyticsRoute();

    expect(response.status).toBe(403);
    expect(analyticsMock.getAdminAnalytics).not.toHaveBeenCalled();
  });

  it('niega el acceso si el perfil no existe', async () => {
    supabaseMock.__queue('profiles', { data: null, error: null });

    const response = await getAdminAnalyticsRoute();

    expect(response.status).toBe(403);
    expect(analyticsMock.getAdminAnalytics).not.toHaveBeenCalled();
  });

  it('niega el acceso cuando no hay sesion', async () => {
    serverAuthMock.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await getAdminAnalyticsRoute();

    expect(response.status).toBe(403);
    expect(analyticsMock.getAdminAnalytics).not.toHaveBeenCalled();
  });

  it('falla cerrado si no se puede leer el flag', async () => {
    // Un error de DB no puede convertirse en "permitido". Sin esto, un fallo de
    // red daria acceso al panel de analytics.
    supabaseMock.__queue('profiles', { data: null, error: { message: 'boom' } });

    const response = await getAdminAnalyticsRoute();

    expect(response.status).toBe(403);
    expect(analyticsMock.getAdminAnalytics).not.toHaveBeenCalled();
  });

  it('deja pasar a un admin y lee el flag con service_role', async () => {
    supabaseMock.__queue('profiles', { data: { is_admin: true }, error: null });

    const response = await getAdminAnalyticsRoute();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ totalSignups: 7 });
    expect(analyticsMock.getAdminAnalytics).toHaveBeenCalled();

    // El flag se resuelve con service_role (supabaseMock), no desde la sesion del
    // cliente: `is_admin` no es escribible por el usuario, asi que ni el valor ni
    // su RLS se pueden manipular desde el navegador.
    const profileCall = supabaseMock.__calls.find((c) => c.table === 'profiles');
    expect(profileCall?.args[0]).toBe('is_admin');
  });

  it('no decide por el email', async () => {
    // El endpoint anterior comparaba contra un email literal. Ahora el unico
    // dato de entrada es el flag, asi que un email conocido sin el flag no
    // alcanza.
    serverAuthMock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'matias.pagano07@gmail.com' } },
      error: null,
    });
    supabaseMock.__queue('profiles', { data: { is_admin: false }, error: null });

    const response = await getAdminAnalyticsRoute();

    expect(response.status).toBe(403);
  });
});
