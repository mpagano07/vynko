import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { authErrorMessage } from '@/lib/auth-errors';
import { validatePassword } from '@/lib/password-policy';
import { getInvitationAccountScope } from '@/lib/accept-invitations';
import { rateLimit, rateLimitPeek } from '@/lib/rate-limit';

/** Intentos de fijar la contrasena por cuenta. */
const MAX_SET_ATTEMPTS = 5;
const SET_WINDOW_MS = 15 * 60 * 1000;

/**
 * Alta de contrasena para una cuenta que entro por invitacion.
 *
 * Va en un endpoint propio, y no en `POST /api/auth/password`, por una razon
 * puntual: ese endpoint exige la contrasena actual como prueba de identidad, y un
 * usuario recien invitado no tiene ninguna. Meterlo por el mismo camino
 * obligaria a aflojar la exigencia, que es justo lo que se acaba de endurecer.
 *
 * La prueba aqui es la invitacion del mismo email, Y que la cuenta no tenga
 * membresias que no provengan de esas invitaciones (ver `getInvitationAccountScope`).
 * La segunda mitad es la importante: sin ella, este endpoint fijaba la contrasena
 * de cualquier cuenta, porque "tiene una invitacion pendiente" sigue siendo
 * cierto para un cliente que ya esta usando Vynko y al que un owner acaba de
 * sumar a otra empresa. Con una sesion robada, eso es una toma de cuenta
 * permanente y sin pedir la contrasena anterior.
 *
 * En resumen: el endpoint sirve para dar la primera contrasena a una cuenta que
 * nace de una invitacion. Para cambiar la de una cuenta existente, el camino es
 * `POST /api/auth/password`, que si la exige.
 *
 * Requiere CSRF porque opera sobre la sesion del usuario.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  let newPassword: unknown;
  try {
    const body = await request.json();
    newPassword = (body as { newPassword?: unknown } | null)?.newPassword;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) {
    return NextResponse.json({ error: 'Sesión no válida' }, { status: 401 });
  }

  if (!user.email_confirmed_at) {
    return NextResponse.json(
      { error: 'Confirmá tu email antes de definir la contraseña' },
      { status: 403 }
    );
  }

  // La invitacion acredita control del buzon, no identidad previa. Limitar los
  // intentos evita que alguien con una sesion robada uegue entradas hasta dar con
  // una contrasena debil: el endpoint no la exige, se elige, asi que es el punto
  // obvio de fuerza bruta. La clave es por usuario, no por IP.
  const scopeLimitKey = `auth:invitation-password:${user.id}`;
  const scopeLimit = await rateLimitPeek(scopeLimitKey, MAX_SET_ATTEMPTS);
  if (!scopeLimit.ok) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Probá de nuevo más tarde.' },
      { status: 429, headers: { 'Retry-After': String(scopeLimit.retryAfterSeconds) } }
    );
  }

  const scope = await getInvitationAccountScope(user.id, user.email);
  if (!scope.hasInvitation) {
    // Sin invitacion no hay prueba de nada. Incluye al que entro por otro lado:
    // para ese racha el endpoint correcto es el del cambio de contrasena, que si
    // pide la actual.
    return NextResponse.json(
      { error: 'No hay una invitación pendiente para este email' },
      { status: 403 }
    );
  }

  if (scope.hasForeignMembership) {
    // Ya es parte de alguna empresa que no viene de esta invitacion: es una
    // cuenta en uso, con una contrasena que alguien mas conoce. Fijar una nueva
    // sin pedir la anterior seria una toma de cuenta, no un alta.
    //
    // El mensaje dice "iniciá sesión" y no "cambiá la contraseña desde Ajustes" a
    // proposito: el 403 lo recibe alguien que ya conocia su propia contraseña y
    // acaba de aceptar una invitacion, no alguien que la olvido. Y Ajustes no es
    // alcanzable para un `member` (ver el redirect por rol en esa pagina), asi
    // que mandarlo ahi lo expulsa de nuevo.
    console.warn(
      `invitation-password: ${user.id} tiene membresias ajenas a sus invitaciones; se rechaza`
    );
    return NextResponse.json(
      { error: 'Esta cuenta ya tiene una contraseña. Iniciá sesión con la que ya tenías.' },
      { status: 403 }
    );
  }

  const passwordCheck = validatePassword(newPassword, { email: user.email });
  if (!passwordCheck.ok) {
    return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
  }

  // Recien aca empieza el bloque que puede tocar la contrasena, y por lo tanto el
  // unico que necesita revocar la sesion en su `finally`. Las validaciones de
  // arriba devuelven sin escribir nada, asi que quedan fuera a proposito: un 403
  // por una contrasena debil o por una invitacion ajena no debe expulsar al
  // usuario de una sesion que nunca estuvo comprometida. El cliente depende de
  // esto para redirigir a /dashboard y seguir trabajando.
  let changed = false;
  try {
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword as string,
    });
    if (updateError) {
      await rateLimit(scopeLimitKey, MAX_SET_ATTEMPTS, SET_WINDOW_MS);
      return NextResponse.json({ error: authErrorMessage(updateError) }, { status: 400 });
    }
    changed = true;

    // Como en el resto de los caminos que cambian la contrasena, se caen todas
    // las sesiones: la del invitado para que entre con la nueva, y cualquier otra
    // que pudiera haber abierto con la anterior. Si esto falla, la contrasena ya
    // quedo cambiada y no se avisa error: el usuario tiene que poder entrar igual.
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
    if (signOutError) {
      console.error('Invitation signOut failed:', signOutError.message);
    }

    return NextResponse.json({ success: true, allSessionsRevoked: true });
  } finally {
    if (!changed) {
      await supabase.auth.signOut({ scope: 'local' });
    }
  }
}
