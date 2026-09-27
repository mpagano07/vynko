import { beforeEach, describe, expect, it, vi } from 'vitest';

const serverAuthMock = {
  auth: {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
  },
};

vi.mock('@/lib/supabase', () => ({
  createServerSupabaseClient: vi.fn(async () => serverAuthMock),
  hardenSessionCookieOptions: (options: Record<string, unknown>) => options,
}));

import { POST as login } from '@/app/api/auth/login/route';
import { POST as signup } from '@/app/api/auth/signup/route';
import { __resetRateLimitStateForTests } from '@/lib/rate-limit';

function post(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function sameOrigin(extra: Record<string, string> = {}): Record<string, string> {
  return { origin: 'https://app.test', 'sec-fetch-site': 'same-origin', ...extra };
}

let seq = 0;
function uniqueEmail(): string {
  seq += 1;
  return `user${seq}@example.com`;
}

beforeEach(() => {
  vi.clearAllMocks();
  // El store en memoria es un modulo compartido: sin reset, el bucket de IP
  // 'unknown' (los Requests de test no traen headers de IP) acumula los
  // incrementos de un test y el siguiente arranca ya cerca del limite.
  __resetRateLimitStateForTests();
  serverAuthMock.auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
  serverAuthMock.auth.signUp.mockResolvedValue({
    data: { user: { identities: [{ id: 'i1' }] }, session: { access_token: 'x' } },
    error: null,
  });
});

describe('POST /api/auth/login', () => {
  it('rechaza requests cross-site', async () => {
    const response = await login(
      post('https://app.test/api/auth/login', { email: 'a@b.com', password: 'x' }, {
        origin: 'https://evil.test',
      })
    );
    expect(response.status).toBe(403);
    expect(serverAuthMock.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('valida el body', async () => {
    const bad = new Request('https://app.test/api/auth/login', { method: 'POST', body: 'not-json' });
    await expect(login(bad)).resolves.toMatchObject({ status: 400 });
    await expect(login(post('https://app.test/api/auth/login', { email: 'a@b.com' }, sameOrigin())))
      .resolves.toMatchObject({ status: 400 });
  });

  it('devuelve 200 y no filtra el token en el body', async () => {
    const response = await login(
      post(
        'https://app.test/api/auth/login',
        { email: '  User@Example.com ', password: 'secreto' },
        sameOrigin()
      )
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(serverAuthMock.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'secreto',
    });
  });

  it('responde 401 con mensaje genérico ante credenciales inválidas', async () => {
    serverAuthMock.auth.signInWithPassword.mockResolvedValueOnce({
      data: {},
      error: { message: 'Invalid login credentials' },
    });
    const response = await login(
      post('https://app.test/api/auth/login', { email: uniqueEmail(), password: 'bad' }, sameOrigin())
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Credenciales inválidas' });
  });

  it('los logins exitosos no gastan presupuesto del limite', async () => {
    // Regresion: el contador se incrementaba antes de autenticar, asi que un
    // login correcto consumia presupuesto igual que uno fallido. Con el limite
    // de cuenta en 5, el sexto login correcto de la misma IP recibia 429. Para
    // un usuario detras de una IP compartida eso era un bloqueo sin haber
    // fallado nunca una credencial.
    const email = uniqueEmail();
    for (let i = 0; i < 10; i++) {
      const response = await login(
        post('https://app.test/api/auth/login', { email, password: 'correcta' }, sameOrigin())
      );
      expect(response.status).toBe(200);
    }

    serverAuthMock.auth.signInWithPassword.mockResolvedValueOnce({
      data: {},
      error: { message: 'Invalid login credentials' },
    });
    const failed = await login(
      post('https://app.test/api/auth/login', { email, password: 'incorrecta' }, sameOrigin())
    );
    expect(failed.status).toBe(401);
  });

  it('aplica rate limiting por cuenta e IP', async () => {
    const email = uniqueEmail();
    serverAuthMock.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: 'Invalid login credentials' },
    });

    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const response = await login(
        post('https://app.test/api/auth/login', { email, password: 'bad' }, sameOrigin())
      );
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});

describe('POST /api/auth/signup', () => {
  it('rechaza requests cross-site', async () => {
    const response = await signup(
      post('https://app.test/api/auth/signup', { email: 'a@b.com', password: 'x' }, {
        origin: 'https://evil.test',
      })
    );
    expect(response.status).toBe(403);
  });

  it('exige email, password, empresa y nombre', async () => {
    await expect(
      signup(post('https://app.test/api/auth/signup', { email: 'a@b.com', password: 'x' }, sameOrigin()))
    ).resolves.toMatchObject({ status: 400 });
  });

  it('crea la cuenta con metadata y redirect interno', async () => {
    const response = await signup(
      post(
        'https://app.test/api/auth/signup',
        { email: uniqueEmail(), password: 'secreto', companyName: ' Acme ', fullName: ' Ana ' },
        sameOrigin()
      )
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, requiresConfirmation: false });

    const call = serverAuthMock.auth.signUp.mock.calls[0][0];
    expect(call.options.data).toEqual({ company_name: 'Acme', full_name: 'Ana' });
    expect(call.options.emailRedirectTo).toMatch(/^https:\/\/app\.test\/auth\/callback\?company_name=Acme&full_name=Ana$/);
  });

  it('reporta requiresConfirmation sin sesión', async () => {
    serverAuthMock.auth.signUp.mockResolvedValueOnce({
      data: { user: { identities: [{ id: 'i1' }] }, session: null },
      error: null,
    });
    const response = await signup(
      post(
        'https://app.test/api/auth/signup',
        { email: uniqueEmail(), password: 'secreto', companyName: 'Acme', fullName: 'Ana' },
        sameOrigin()
      )
    );
    await expect(response.json()).resolves.toEqual({ success: true, requiresConfirmation: true });
  });

  it('devuelve 409 si el email ya está registrado', async () => {
    serverAuthMock.auth.signUp.mockResolvedValueOnce({
      data: { user: { identities: [] }, session: null },
      error: null,
    });
    const response = await signup(
      post(
        'https://app.test/api/auth/signup',
        { email: uniqueEmail(), password: 'secreto', companyName: 'Acme', fullName: 'Ana' },
        sameOrigin()
      )
    );
    expect(response.status).toBe(409);
  });

  it('aplica rate limiting por email', async () => {
    const email = uniqueEmail();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await signup(
        post(
          'https://app.test/api/auth/signup',
          { email, password: 'secreto', companyName: 'Acme', fullName: 'Ana' },
          sameOrigin()
        )
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });
});
