import { beforeEach, describe, expect, it, vi } from 'vitest';

const serverAuthMock = {
  auth: {
    signOut: vi.fn(),
  },
};

vi.mock('@/lib/supabase', () => ({
  createServerSupabaseClient: vi.fn(async () => serverAuthMock),
}));

import { POST } from './route';
import { LAST_SEEN_COOKIE } from '@/lib/session-policy';

function makeRequest(extraHeaders: Record<string, string> = {}): Request {
  return new Request('https://app.test/api/auth/logout', {
    method: 'POST',
    headers: { origin: 'https://app.test', 'sec-fetch-site': 'same-origin', ...extraHeaders },
  });
}

function lastSeenCookie(response: Response): string | undefined {
  return response.headers.getSetCookie().find((c) => c.startsWith(`${LAST_SEEN_COOKIE}=`));
}

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    serverAuthMock.auth.signOut.mockReset();
    serverAuthMock.auth.signOut.mockResolvedValue({ error: null });
  });

  it('revoca la sesión en el servidor', async () => {
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(serverAuthMock.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('borra la cookie de última actividad', async () => {
    // Regresión: el logout solo revocaba la sesión de Supabase y dejaba vivo el
    // `vynko_last_seen` del proxy. Si el usuario se iba más de 30 minutos y
    // volvía a loguearse, el primer request que atraviesa el proxy comparaba ese
    // timestamp viejo contra INACTIVITY_TIMEOUT_MS, lo daba por vencido y lo
    // expulsaba con `reason=inactive` en el mismo instante en que acababa de
    // autenticarse. Es decir, "tu sesión expiró por inactividad" a alguien que
    // recién acaba de entrar.
    const res = await POST(makeRequest());

    const cookie = lastSeenCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Path=/');
    // HttpOnly: el cliente no debe poder leerla ni extenderla.
    expect(cookie).toContain('HttpOnly');
  });

  it('borra la cookie de última actividad aunque la revocación falle', async () => {
    // El logout es idempotente: si la sesión ya estaba caída, el usuario igual
    // queda deslogueado del lado del cliente, y la cookie de inactividad tiene
    // que irse igual o el próximo login vuelve a expirar solo.
    serverAuthMock.auth.signOut.mockRejectedValue(new Error('network'));

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(lastSeenCookie(res)).toContain('Max-Age=0');
  });

  it('rechaza el logout cross-origin sin tocar nada', async () => {
    const res = await POST(makeRequest({ origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' }));

    expect(res.status).toBe(403);
    expect(serverAuthMock.auth.signOut).not.toHaveBeenCalled();
    // Un logout rechazado no debe borrar la cookie: si el attacker no puede
    // cerrar la sesión, tampoco puede usar el endpoint para limpiar el
    // timestamp y forzar el reingreso.
    expect(lastSeenCookie(res)).toBeUndefined();
  });
});
