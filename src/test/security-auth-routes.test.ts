import { beforeEach, describe, expect, it, vi } from 'vitest';

const serverAuthMock = {
  auth: {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    setSession: vi.fn(),
  },
};

const authServiceMock = { sendResetPasswordEmail: vi.fn() };
const acceptInvitationsMock = { acceptInvitationsForUser: vi.fn() };

vi.mock('@/lib/supabase', () => ({
  createServerSupabaseClient: vi.fn(async () => serverAuthMock),
  hardenSessionCookieOptions: (options: Record<string, unknown>) => options,
}));

vi.mock('@/lib/auth-service', () => ({
  sendResetPasswordEmail: (...args: unknown[]) =>
    authServiceMock.sendResetPasswordEmail(...(args as [])),
}));

vi.mock('@/lib/accept-invitations', () => ({
  acceptInvitationsForUser: (...args: unknown[]) =>
    acceptInvitationsMock.acceptInvitationsForUser(...(args as [])),
}));

import { POST as login } from '@/app/api/auth/login/route';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route';
import { POST as changePassword } from '@/app/api/auth/password/route';
import { POST as acceptInvitation } from '@/app/api/invitations/accept/route';
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
  // Sesion valida por defecto: los tests que necesitan una sesion ausente lo
  // sobreescriben con mockResolvedValueOnce.
  serverAuthMock.auth.getUser.mockResolvedValue({
    data: { user: { id: 'u1', email: 'user@example.com' } },
    error: null,
  });
  serverAuthMock.auth.updateUser.mockResolvedValue({ data: {}, error: null });
  serverAuthMock.auth.setSession.mockResolvedValue({ data: { session: { user: {} } }, error: null });
  authServiceMock.sendResetPasswordEmail.mockResolvedValue({
    data: { success: true, message: 'Email enviado' },
    status: 200,
    headers: {},
  });
  acceptInvitationsMock.acceptInvitationsForUser.mockResolvedValue({ accepted: 1 });
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

describe('POST /api/auth/forgot-password', () => {
  it('rechaza requests cross-site para que otra web no dispare emails de reset', async () => {
    // Sin este control, un sitio externo podia usar la ruta como email bombing
    // contra una victima ajena.
    const response = await forgotPassword(
      post('https://app.test/api/auth/forgot-password', { email: 'a@b.com' }, {
        origin: 'https://evil.test',
      })
    );
    expect(response.status).toBe(403);
    expect(authServiceMock.sendResetPasswordEmail).not.toHaveBeenCalled();
  });

  it('responde generico si el servicio falla, sin filtrar el error', async () => {
    // Un 500 con el mensaje del error filtraria si el email existe o el motivo
    // real del fallo. La respuesta tiene que ser indistinguible de la exitosa.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    authServiceMock.sendResetPasswordEmail.mockRejectedValueOnce(new Error('user not found: a@b.com'));

    const response = await forgotPassword(
      post('https://app.test/api/auth/forgot-password', { email: 'a@b.com' }, sameOrigin())
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, message: 'Email enviado' });
    consoleSpy.mockRestore();
  });
});

describe('POST /api/auth/password', () => {
  const url = 'https://app.test/api/auth/password';

  it('rechaza requests cross-site', async () => {
    const response = await changePassword(
      post(url, { action: 'verify', currentPassword: 'x' }, { origin: 'https://evil.test' })
    );
    expect(response.status).toBe(403);
    expect(serverAuthMock.auth.getUser).not.toHaveBeenCalled();
  });

  it('exige una sesion valida', async () => {
    serverAuthMock.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'no' } });
    const response = await changePassword(post(url, { action: 'verify', currentPassword: 'x' }, sameOrigin()));
    expect(response.status).toBe(401);
  });

  it('rechaza una accion desconocida', async () => {
    const response = await changePassword(post(url, { action: 'borrar' }, sameOrigin()));
    expect(response.status).toBe(400);
    expect(serverAuthMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it('exige un largo minimo en el cambio de contrasena', async () => {
    const response = await changePassword(post(url, { action: 'change', newPassword: 'corta' }, sameOrigin()));
    expect(response.status).toBe(400);
    // No debe llegar a Supabase: un cambio invalido no se ejecuta a medias.
    expect(serverAuthMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it('no cambia la contrasena cuando la actual es incorrecta', async () => {
    serverAuthMock.auth.signInWithPassword.mockResolvedValueOnce({
      data: {},
      error: { message: 'Invalid login credentials' },
    });
    // El valor da igual: el fallo lo inyecta el mock de signInWithPassword, no
    // la contrasena en si. Se usa 'x' como en el resto del archivo.
    const response = await changePassword(
      post(url, { action: 'verify', currentPassword: 'x' }, sameOrigin())
    );

    expect(response.status).toBe(400);
    expect(serverAuthMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it('no distingue contrasena incorrecta de usuario inexistente', async () => {
    // Mismo status y mismo cuerpo para los dos casos: si difieren, un atacante
    // podria enumerar cuentas registradas probando el endpoint verify.
    const incorrecta = await (async () => {
      serverAuthMock.auth.signInWithPassword.mockResolvedValueOnce({
        data: {},
        error: { message: 'Invalid login credentials' },
      });
      const r = await changePassword(post(url, { action: 'verify', currentPassword: 'x' }, sameOrigin()));
      return { status: r.status, body: await r.json() };
    })();

    const inexistente = await (async () => {
      serverAuthMock.auth.signInWithPassword.mockResolvedValueOnce({
        data: {},
        error: { message: 'User not found' },
      });
      const r = await changePassword(post(url, { action: 'verify', currentPassword: 'x' }, sameOrigin()));
      return { status: r.status, body: await r.json() };
    })();

    expect(incorrecta).toEqual(inexistente);
  });
});

describe('POST /api/invitations/accept', () => {
  const url = 'https://app.test/api/invitations/accept';

  it('rechaza requests cross-site', async () => {
    const response = await acceptInvitation(post(url, {}, { origin: 'https://evil.test' }));
    expect(response.status).toBe(403);
    expect(acceptInvitationsMock.acceptInvitationsForUser).not.toHaveBeenCalled();
  });

  it('no acepta nada sin sesion, en vez de fallar', async () => {
    serverAuthMock.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no' } });
    const response = await acceptInvitation(post(url, {}, sameOrigin()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: 0 });
    expect(acceptInvitationsMock.acceptInvitationsForUser).not.toHaveBeenCalled();
  });

  it('acepta las invitaciones del usuario autenticado', async () => {
    const response = await acceptInvitation(post(url, {}, sameOrigin()));

    expect(response.status).toBe(200);
    expect(acceptInvitationsMock.acceptInvitationsForUser).toHaveBeenCalledWith({
      id: 'u1',
      email: 'user@example.com',
    });
  });
});
