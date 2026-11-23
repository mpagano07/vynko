import { describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const { signInWithOAuth } = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(
    async (options: { options?: { redirectTo?: string } }) => {
      void options;
      return {
        data: { url: 'https://accounts.google.com/o/oauth2/auth' },
        error: null,
      };
    }
  ),
}));

vi.mock('@/lib/supabase', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { signInWithOAuth },
  })),
}));

vi.mock('@/lib/rate-limit', () => ({
  getClientIp: vi.fn(() => '127.0.0.1'),
  rateLimit: vi.fn(async () => ({ ok: true })),
}));

describe('GET /api/auth/oauth', () => {
  it('no inyecta un next=/dashboard: el callback deriva el destino', async () => {
    const res = await GET(new Request('http://localhost:3000/api/auth/oauth?provider=google'));

    expect(res.ok).toBe(true);
    const redirectTo = signInWithOAuth.mock.calls.at(-1)?.[0]?.options?.redirectTo;
    expect(redirectTo).toContain('/auth/callback');
    expect(redirectTo).not.toContain('next=');
  });

  it('propaga un next explícito como path interno validado', async () => {
    await GET(new Request('http://localhost:3000/api/auth/oauth?provider=google&next=%2Fsettings'));

    const redirectTo = signInWithOAuth.mock.calls.at(-1)?.[0]?.options?.redirectTo;
    expect(redirectTo).toContain('next=%2Fsettings');
  });
});
