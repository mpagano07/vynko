import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSession = vi.fn();

vi.mock('@/lib/supabase', () => ({
  createServerSupabaseClient: vi.fn(
    async (opts?: { cookieSetAll?: (cookies: unknown[]) => void }) => {
      opts?.cookieSetAll?.([
        {
          name: 'sb-test-auth-token',
          value: 'cookie-value',
          options: { path: '/', httpOnly: true, sameSite: 'lax' },
        },
      ]);
      return { auth: { setSession } };
    }
  ),
}));

import { POST } from '@/app/api/auth/session/route';
import { __resetRateLimitStateForTests } from '@/lib/rate-limit';
import { LAST_SEEN_COOKIE } from '@/lib/session-policy';

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://app.test/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const sameOrigin = { origin: 'https://app.test', 'sec-fetch-site': 'same-origin' };
const tokens = { access_token: 'access-1', refresh_token: 'refresh-1' };

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitStateForTests();
  setSession.mockResolvedValue({ data: { session: { access_token: 'access-1' } }, error: null });
});

describe('POST /api/auth/session', () => {
  it('rechaza requests cross-site', async () => {
    const response = await POST(post(tokens, { origin: 'https://evil.test' }));

    expect(response.status).toBe(403);
    expect(setSession).not.toHaveBeenCalled();
  });

  it('valida que lleguen los dos tokens', async () => {
    expect((await POST(post({ access_token: 'a' }, sameOrigin))).status).toBe(400);
    expect((await POST(post({ refresh_token: 'r' }, sameOrigin))).status).toBe(400);
    expect(setSession).not.toHaveBeenCalled();
  });

  it('abre la sesión y escribe las cookies HttpOnly del servidor', async () => {
    const response = await POST(post(tokens, sameOrigin));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(setSession).toHaveBeenCalledWith(tokens);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('sb-test-auth-token=cookie-value');
    expect(cookie).toContain('HttpOnly');
    // El proxy exige esta marca; si no se escribe al abrir sesion, el primer
    // request autenticado se toma como inactividad vencida.
    expect(response.cookies.get(LAST_SEEN_COOKIE)?.value).toBeTruthy();
  });

  it('no escribe cookies si el token es inválido o expiró', async () => {
    setSession.mockResolvedValue({ data: { session: null }, error: { message: 'expired' } });

    const response = await POST(post(tokens, sameOrigin));

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
