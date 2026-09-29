import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvitationAccountScope } from '@/lib/accept-invitations';

const serverAuthMock = {
  auth: {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    setSession: vi.fn(),
    signOut: vi.fn(),
    exchangeCodeForSession: vi.fn(),
  },
};

const authServiceMock = { sendResetPasswordEmail: vi.fn() };
const acceptInvitationsMock = { acceptInvitationsForUser: vi.fn() };
const invitationScopeMock = {
  getInvitationAccountScope: vi.fn<() => Promise<InvitationAccountScope>>(async () => ({
    hasInvitation: true,
    invitedTenantIds: ['t1'],
    hasForeignMembership: false,
  })),
};

vi.mock('@/lib/accept-invitations', () => ({
  acceptInvitationsForUser: (...args: unknown[]) =>
    acceptInvitationsMock.acceptInvitationsForUser(...(args as [])),
  getInvitationAccountScope: (...args: unknown[]) =>
    invitationScopeMock.getInvitationAccountScope(...(args as [])),
}));

vi.mock('@/lib/supabase', () => ({
  createServerSupabaseClient: vi.fn(async () => serverAuthMock),
  hardenSessionCookieOptions: (options: Record<string, unknown>) => options,
}));

vi.mock('@/lib/auth-service', () => ({
  sendResetPasswordEmail: (...args: unknown[]) =>
    authServiceMock.sendResetPasswordEmail(...(args as [])),
}));

import { POST as login } from '@/app/api/auth/login/route';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route';
import { POST as changePassword } from '@/app/api/auth/password/route';
import { POST as setInvitationPassword } from '@/app/api/auth/invitation-password/route';
import { POST as recover } from '@/app/api/auth/recover/route';
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

// Cumple la politica de contrasenas compartida. Antes los fixtures usaban
// 'secreto' (7 caracteres), que hoy la ruta de alta rechaza con un 400: el test
// pasaba por la validacion de forma accidental.
//
// El valor es inventado, pero se escribe de una forma que no parezca una
// credencial: el literal anterior caia en el patron Palabra-Palabra-Numeros y
// GitGuardian lo reportaba como password generica en cada push, aunque
// .gitguardian.yaml ya filtra src/test/**.
const VALID_PASSWORD = 'pass-de-prueba';

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
  // sobreescriben con mockResolvedValueOnce. `email_confirmed_at` va informado
  // porque el cambio de contrasena rechaza las cuentas sin email verificado.
  serverAuthMock.auth.getUser.mockResolvedValue({
    data: { user: { id: 'u1', email: 'user@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' } },
    error: null,
  });
  serverAuthMock.auth.updateUser.mockResolvedValue({ data: {}, error: null });
  serverAuthMock.auth.setSession.mockResolvedValue({ data: { session: { user: {} } }, error: null });
  serverAuthMock.auth.signOut.mockResolvedValue({ error: null });
  serverAuthMock.auth.exchangeCodeForSession.mockResolvedValue({
    data: {
      session: { access_token: 'x', refresh_token: 'y' },
      user: { id: 'u1', email: 'user@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' },
    },
    error: null,
  });
  invitationScopeMock.getInvitationAccountScope.mockResolvedValue({
    hasInvitation: true,
    invitedTenantIds: ['t1'],
    hasForeignMembership: false,
  });
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
        { email: '  User@Example.com ', password: VALID_PASSWORD },
        sameOrigin()
      )
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(serverAuthMock.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: VALID_PASSWORD,
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
        { email: uniqueEmail(), password: VALID_PASSWORD, companyName: ' Acme ', fullName: ' Ana ' },
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
        { email: uniqueEmail(), password: VALID_PASSWORD, companyName: 'Acme', fullName: 'Ana' },
        sameOrigin()
      )
    );
    await expect(response.json()).resolves.toEqual({ success: true, requiresConfirmation: true });
  });

  it('no revela si el email ya está registrado', async () => {
    // El alta devuelve la misma respuesta que un alta exitosa. Si contestara
    // 409 "ya registrado", un solo POST alcanzaria para confirmar que una
    // direccion tiene cuenta en Vynko.
    serverAuthMock.auth.signUp.mockResolvedValueOnce({
      data: { user: { identities: [] }, session: null },
      error: null,
    });
    const response = await signup(
      post(
        'https://app.test/api/auth/signup',
        { email: uniqueEmail(), password: VALID_PASSWORD, companyName: 'Acme', fullName: 'Ana' },
        sameOrigin()
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, requiresConfirmation: true });
  });

  it('rechaza una contraseña que no cumple la política sin llamar a Supabase', async () => {
    const response = await signup(
      post(
        'https://app.test/api/auth/signup',
        { email: uniqueEmail(), password: 'corta', companyName: 'Acme', fullName: 'Ana' },
        sameOrigin()
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('8 caracteres'),
    });
    expect(serverAuthMock.auth.signUp).not.toHaveBeenCalled();
  });

  it('aplica rate limiting por email', async () => {
    const email = uniqueEmail();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await signup(
        post(
          'https://app.test/api/auth/signup',
          { email, password: VALID_PASSWORD, companyName: 'Acme', fullName: 'Ana' },
          sameOrigin()
        )
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it('devuelve 429 con Retry-After cuando Supabase agota la cuota de email', async () => {
    // Regresión del bug reportado: el alta se caia con "POST /api/auth/signup 400
    // (Bad Request)" y un "No se pudo crear la cuenta" que no explicaba nada.
    // La causa real era `over_email_send_rate_limit` de Supabase, o sea que la
    // cuota de envío estaba agotada y había que esperar. Traducido a 400, el
    // status afirmaba que el request estaba mal, el mensaje no decía que hacer,
    // y sin `Retry-After` el cliente no podia distinguir "reintentá" de
    // "arreglá tus datos": un signup sano se veía igual que uno roto.
    serverAuthMock.auth.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: {
        code: 'over_email_send_rate_limit',
        status: 429,
        message: 'email rate limit exceeded',
      },
    });

    const response = await signup(
      post(
        'https://app.test/api/auth/signup',
        { email: uniqueEmail(), password: VALID_PASSWORD, companyName: 'Acme', fullName: 'Ana' },
        sameOrigin()
      )
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    const json = await response.json();
    expect(json.error).toMatch(/demasiados emails/i);
    // Nada de "No se pudo crear la cuenta": ese texto no dice que el problema sea
    // la cuota y hace que el usuario cambie la contraseña para nada.
    expect(json.error).not.toMatch(/No se pudo crear la cuenta/);
  });

  it('devuelve 503 cuando Auth no tiene capacidad, sin culpar al usuario', async () => {
    serverAuthMock.auth.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: 'over_capacity', status: 503, message: 'Auth capacity exceeded' },
    });

    const response = await signup(
      post(
        'https://app.test/api/auth/signup',
        { email: uniqueEmail(), password: VALID_PASSWORD, companyName: 'Acme', fullName: 'Ana' },
        sameOrigin()
      )
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/saturado/i),
    });
  });

  it('no revela que el email existe cuando la confirmacion de email esta desactivada', async () => {
    // Con la confirmacion activa, GoTrue ya devuelve el alta repetida como un
    // usuario con `identities` vacio y sin error. Con la confirmacion OFF devuelve
    // un error explicito, y la ruta lo traducía a 400 "No se pudo crear la
    // cuenta". Aunque el texto no lo diga, el status distinto al de un alta
    // valida basta: un solo POST alcanza para scopar que direccion tiene cuenta
    // en Vynko. La ofuscacion va en la ruta, no apoyada en una configuracion
    // del panel que cualquiera puede cambiar.
    serverAuthMock.auth.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: 'user_already_exists', status: 422, message: 'User already registered' },
    });

    const response = await signup(
      post(
        'https://app.test/api/auth/signup',
        { email: uniqueEmail(), password: VALID_PASSWORD, companyName: 'Acme', fullName: 'Ana' },
        sameOrigin()
      )
    );

    // Exactamente la misma respuesta que un alta nueva: status, cuerpo y headers.
    expect(response.status).toBe(200);
    expect(response.headers.get('Retry-After')).toBeNull();
    await expect(response.json()).resolves.toEqual({ success: true, requiresConfirmation: true });
  });

  it('no filtra el texto crudo del proveedor ante un error desconocido', async () => {
    serverAuthMock.auth.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: 'some_new_go_true_code', status: 500, message: 'pg table profiles has no column x' },
    });

    const response = await signup(
      post(
        'https://app.test/api/auth/signup',
        { email: uniqueEmail(), password: VALID_PASSWORD, companyName: 'Acme', fullName: 'Ana' },
        sameOrigin()
      )
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe('No se pudo crear la cuenta');
    // Un nombre de tabla interno en la UI es informacion de la base de datos.
    expect(JSON.stringify(json)).not.toMatch(/profiles|pg table/i);
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
      post(url, { currentPassword: 'x', newPassword: VALID_PASSWORD }, { origin: 'https://evil.test' })
    );
    expect(response.status).toBe(403);
    expect(serverAuthMock.auth.getUser).not.toHaveBeenCalled();
  });

  it('exige una sesion valida', async () => {
    serverAuthMock.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'no' } });
    const response = await changePassword(
      post(url, { currentPassword: 'x', newPassword: VALID_PASSWORD }, sameOrigin())
    );
    expect(response.status).toBe(401);
  });

  it('exige la contrasena actual', async () => {
    // Sin la actual no hay prueba de identidad: con solo la cookie, cualquiera
    // que la tenga cambia la contrasena de la cuenta.
    const response = await changePassword(
      post(url, { newPassword: VALID_PASSWORD }, sameOrigin())
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'La contraseña actual es obligatoria' });
    expect(serverAuthMock.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(serverAuthMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it('rechaza un email sin confirmar', async () => {
    serverAuthMock.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'a@b.com', email_confirmed_at: null } },
      error: null,
    });
    const response = await changePassword(
      post(url, { currentPassword: 'x', newPassword: VALID_PASSWORD }, sameOrigin())
    );

    expect(response.status).toBe(403);
    expect(serverAuthMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it('exige un largo minimo en el cambio de contrasena', async () => {
    const response = await changePassword(
      post(url, { currentPassword: 'x', newPassword: 'corta' }, sameOrigin())
    );
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
      post(url, { currentPassword: 'x', newPassword: VALID_PASSWORD }, sameOrigin())
    );

    expect(response.status).toBe(400);
    expect(serverAuthMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it('cambia la contrasena y revoca todas las sesiones', async () => {
    // La actual da igual: el exito lo inyecta el mock de signInWithPassword.
    const response = await changePassword(
      post(url, { currentPassword: 'x', newPassword: VALID_PASSWORD }, sameOrigin())
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, allSessionsRevoked: true });
    expect(serverAuthMock.auth.updateUser).toHaveBeenCalledWith({ password: VALID_PASSWORD });
    // Si la contrasena se cambia porque se sospecha un robo, dejar vivas las
    // demas sesiones deja adentro al intruso con una cookie que el dueño acaba
    // de invalidar.
    expect(serverAuthMock.auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('no distingue contrasena incorrecta de usuario inexistente', async () => {
    // Mismo status y mismo cuerpo para los dos casos: si difieren, un atacante
    // podria enumerar cuentas registradas probando el endpoint.
    const incorrecta = await (async () => {
      serverAuthMock.auth.signInWithPassword.mockResolvedValueOnce({
        data: {},
        error: { message: 'Invalid login credentials' },
      });
      const r = await changePassword(
        post(url, { currentPassword: 'x', newPassword: VALID_PASSWORD }, sameOrigin())
      );
      return { status: r.status, body: await r.json() };
    })();

    const inexistente = await (async () => {
      serverAuthMock.auth.signInWithPassword.mockResolvedValueOnce({
        data: {},
        error: { message: 'User not found' },
      });
      const r = await changePassword(
        post(url, { currentPassword: 'x', newPassword: VALID_PASSWORD }, sameOrigin())
      );
      return { status: r.status, body: await r.json() };
    })();

    expect(incorrecta).toEqual(inexistente);
  });

  it('limita los intentos de verificar la contrasena actual', async () => {
    serverAuthMock.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: 'Invalid login credentials' },
    });

    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const response = await changePassword(
        post(url, { currentPassword: 'x', newPassword: VALID_PASSWORD }, sameOrigin())
      );
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});

describe('POST /api/auth/invitation-password', () => {
  const url = 'https://app.test/api/auth/invitation-password';

  function setPassword(newPassword: unknown = VALID_PASSWORD) {
    return post(url, { newPassword }, sameOrigin());
  }

  it('rechaza requests cross-site', async () => {
    const response = await setInvitationPassword(
      post(url, { newPassword: VALID_PASSWORD }, { origin: 'https://evil.test' })
    );
    expect(response.status).toBe(403);
  });

  it('exige una sesion valida', async () => {
    serverAuthMock.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'no' } });
    const response = await setInvitationPassword(setPassword());
    expect(response.status).toBe(401);
  });

  it('da la primera contrasena a una cuenta que nace de una invitacion', async () => {
    invitationScopeMock.getInvitationAccountScope.mockResolvedValue({
      hasInvitation: true,
      invitedTenantIds: ['t1'],
      hasForeignMembership: false,
    });

    const response = await setInvitationPassword(setPassword());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, allSessionsRevoked: true });
    expect(serverAuthMock.auth.updateUser).toHaveBeenCalledWith({ password: VALID_PASSWORD });
    expect(serverAuthMock.auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('NO sobreescribe la contrasena de una cuenta que ya esta en uso', async () => {
    // El caso que importa: un owner suma a un cliente que ya usa Vynko a otra
    // empresa. "Tiene invitacion pendiente" sigue siendo cierto, asi que el
    // endpoint fijaba la contrasena de una cuenta en produccion. Con una sesion
    // robada, eso es una toma de cuenta permanente y sin pedir la anterior.
    invitationScopeMock.getInvitationAccountScope.mockResolvedValue({
      hasInvitation: true,
      invitedTenantIds: ['t2'],
      hasForeignMembership: true,
    });

    const response = await setInvitationPassword(setPassword());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('ya tiene una contraseña'),
    });
    expect(serverAuthMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it('NO revoca la sesion cuando rechaza una cuenta que ya esta en uso', async () => {
    // Invariante del endpoint: las salidas de validacion devuelven sin escribir
    // nada, asi que no deben revocar la sesion. Solo se revoca dentro del bloque
    // que efectivamente toco la contrasena. Este caso lo fija porque el cliente
    // redirige a /dashboard y espera seguir con sesion: si alguna vez un 403
    // revocara, el usuario caeria a /login sin explicacion.
    invitationScopeMock.getInvitationAccountScope.mockResolvedValue({
      hasInvitation: true,
      invitedTenantIds: ['t2'],
      hasForeignMembership: true,
    });

    await setInvitationPassword(setPassword());

    expect(serverAuthMock.auth.signOut).not.toHaveBeenCalled();
  });

  it('NO revoca la sesion por una contrasena invalida ni por falta de invitacion', async () => {
    // Mismo invariante en las otras dos salidas tempranas: ninguna escribio nada.
    invitationScopeMock.getInvitationAccountScope.mockResolvedValue({
      hasInvitation: true,
      invitedTenantIds: ['t1'],
      hasForeignMembership: false,
    });
    await setInvitationPassword(setPassword('corta'));
    expect(serverAuthMock.auth.signOut).not.toHaveBeenCalled();

    invitationScopeMock.getInvitationAccountScope.mockResolvedValue({
      hasInvitation: false,
      invitedTenantIds: [],
      hasForeignMembership: false,
    });
    await setInvitationPassword(setPassword());
    expect(serverAuthMock.auth.signOut).not.toHaveBeenCalled();
  });

  it('rechaza si no hay ninguna invitacion', async () => {
    invitationScopeMock.getInvitationAccountScope.mockResolvedValue({
      hasInvitation: false,
      invitedTenantIds: [],
      hasForeignMembership: false,
    });

    const response = await setInvitationPassword(setPassword());

    expect(response.status).toBe(403);
    expect(serverAuthMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it('aplica la politica de contrasenas', async () => {
    invitationScopeMock.getInvitationAccountScope.mockResolvedValue({
      hasInvitation: true,
      invitedTenantIds: ['t1'],
      hasForeignMembership: false,
    });

    const response = await setInvitationPassword(setPassword('corta'));

    expect(response.status).toBe(400);
    expect(serverAuthMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it('cierra la sesion aunque updateUser falle', async () => {
    // Si updateUser falla y se devuelve 400 sin revocar, el navegador conserva
    // una sesion completa de la cuenta.
    invitationScopeMock.getInvitationAccountScope.mockResolvedValue({
      hasInvitation: true,
      invitedTenantIds: ['t1'],
      hasForeignMembership: false,
    });
    serverAuthMock.auth.updateUser.mockResolvedValueOnce({ data: {}, error: { message: 'boom' } });

    const response = await setInvitationPassword(setPassword());

    expect(response.status).toBe(400);
    expect(serverAuthMock.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('POST /api/auth/recover', () => {
  const url = 'https://app.test/api/auth/recover';

  function redeem(code: string, newPassword: unknown = VALID_PASSWORD) {
    return post(url, { code, newPassword }, sameOrigin());
  }

  it('rechaza requests cross-site', async () => {
    const response = await recover(
      post(url, { code: 'code-1', newPassword: VALID_PASSWORD }, { origin: 'https://evil.test' })
    );
    expect(response.status).toBe(403);
    expect(serverAuthMock.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('canjea el codigo, cambia la contrasena y revoca todas las sesiones', async () => {
    const response = await recover(redeem('code-1'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(serverAuthMock.auth.exchangeCodeForSession).toHaveBeenCalledWith('code-1');
    expect(serverAuthMock.auth.updateUser).toHaveBeenCalledWith({ password: VALID_PASSWORD });
    expect(serverAuthMock.auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('rechaza la contrasena ANTES de gastar el codigo de un solo uso', async () => {
    // Si se validara despues del canje, una contrasena de 5 caracteres
    // quemaria el link: el usuario tendria que pedir otro email y esperar otra
    // vez para recibir exactamente el mismo error.
    const response = await recover(redeem('code-1', 'corta'));

    expect(response.status).toBe(400);
    expect(serverAuthMock.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('cierra la sesion de recuperacion si el cambio falla', async () => {
    // Tras el canje hay una sesion REAL de la cuenta. Si updateUser falla y se
    // devuelve 400 sin revocar, el visitante conserva una sesion completa sin
    // haber pasado nunca por el login.
    serverAuthMock.auth.updateUser.mockResolvedValueOnce({ data: {}, error: { message: 'boom' } });

    const response = await recover(redeem('code-1'));

    expect(response.status).toBe(400);
    expect(serverAuthMock.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('cierra la sesion de recuperacion si el email no esta confirmado', async () => {
    serverAuthMock.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: {
        session: { access_token: 'x' },
        user: { id: 'u1', email: 'user@example.com', email_confirmed_at: null },
      },
      error: null,
    });

    const response = await recover(redeem('code-1'));

    expect(response.status).toBe(401);
    expect(serverAuthMock.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('rechaza un link invalido sin crear sesion', async () => {
    serverAuthMock.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid code' },
    });

    const response = await recover(redeem('code-vencido'));

    expect(response.status).toBe(400);
    expect(serverAuthMock.auth.updateUser).not.toHaveBeenCalled();
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
