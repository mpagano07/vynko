import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { authErrorMessage } from '@/lib/auth-errors';
import { validatePassword, PASSWORD_MAX_LENGTH } from '@/lib/password-policy';
import { rateLimit, rateLimitPeek, getClientIp } from '@/lib/rate-limit';

/**
 * Intentos fallidos de verificacion de la contrasena actual, por sesion.
 *
 * No se reutiliza la clave de `POST /api/auth/login` a proposito. Este endpoint
 * llama a `signInWithPassword` por su cuenta: el limite del login no lo cubre,
 * y compartido alguien con una cookie robada podria agotar el presupuesto de la
 * victima y dejarla sin poder entrar (denegacion de servicio). Con una clave
 * propia el dano se queda en quien ya tiene la cookie.
 */
const MAX_VERIFY_ATTEMPTS = 5;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;

/**
 * Cambio de contrasena de una cuenta que YA tiene sesion.
 *
 * Exige la contrasena actual en el mismo request. Antes eran dos llamadas
 * sueltas: un `verify` que comprobaba la actual y un `change` que la aplicaba.
 * Eran independientes, asi que la comprobacion no ataba a nada: alcanza con
 * saltear el primer pedido y mandar solo el `change` para cambiar la contrasena
 * de cualquiera que tenga una cookie de sesion. Con una cookie robada, eso es
 * una toma de cuenta silenciosa. Ahora hay una sola accion y pide la actual.
 *
 * Que la compruebe `signInWithPassword` es lo que permite no inventar un endpoint
 * "comparar contrasena": ademas devuelve el mismo error ante un email
 * inexistente, asi que no revela si una cuenta esta registrada.
 *
 * Los otros dos caminos que escriben una contrasena (recuperacion e
 * invitacion) no pasan por aca: en esos casos la prueba es el `code` del email o
 * la invitacion, no una contrasena previa. Cada endpoint tiene una sola prueba
 * de identidad y no se mezclan.
 *
 * Requiere CSRF porque opera sobre la sesion del usuario.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  let currentPassword: unknown;
  let newPassword: unknown;
  try {
    const body = await request.json();
    currentPassword = (body as { currentPassword?: unknown } | null)?.currentPassword;
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

  // Una cuenta sin email verificado no deberia tener sesion, pero si la tiene
  // (porque el proyecto de Supabase tiene "Confirm email" apagado) no se le
  // permite cambiar la contrasena: la prueba de identidad no esta completa.
  if (!user.email_confirmed_at) {
    return NextResponse.json(
      { error: 'Confirmá tu email antes de cambiar la contraseña' },
      { status: 403 }
    );
  }

  if (typeof currentPassword !== 'string' || !currentPassword) {
    return NextResponse.json({ error: 'La contraseña actual es obligatoria' }, { status: 400 });
  }
  if (currentPassword.length > PASSWORD_MAX_LENGTH) {
    return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 400 });
  }

  // Solo los intentos fallidos consumen presupuesto: un owner que cambia su
  // contrasena cinco veces seguidas no se bloquea a si mismo.
  const verifyKey = `auth:password:verify:${user.id}:${getClientIp(request)}`;
  const verifyLimit = await rateLimitPeek(verifyKey, MAX_VERIFY_ATTEMPTS);
  if (!verifyLimit.ok) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Probá de nuevo más tarde.' },
      { status: 429, headers: { 'Retry-After': String(verifyLimit.retryAfterSeconds) } }
    );
  }

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });

  if (verifyError) {
    // No se distingue "contrasena incorrecta" de "usuario inexistente" a
    // proposito: responder distinto permitiria enumerar cuentas registradas.
    const limit = await rateLimit(verifyKey, MAX_VERIFY_ATTEMPTS, VERIFY_WINDOW_MS);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Demasiados intentos. Probá de nuevo más tarde.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }
    return NextResponse.json({ error: 'La contraseña actual es incorrecta' }, { status: 400 });
  }

  const passwordCheck = validatePassword(newPassword, { email: user.email });
  if (!passwordCheck.ok) {
    return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword as string,
  });
  if (updateError) {
    return NextResponse.json({ error: authErrorMessage(updateError) }, { status: 400 });
  }

  // Revoca TODAS las sesiones, no solo la actual. Es el escenario que mas importa
  // para este endpoint: si la contrasena se cambia porque se sospecha un robo,
  // dejar vivas las demas sesiones dejaria al intruso adentro con una cookie que
  // el dueño acaba de invalidar. El usuario tiene que volver a entrar, que es
  // justo lo que se espera despues de cambiar una contrasena.
  const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
  if (signOutError) {
    console.error('Password change signOut failed:', signOutError.message);
  }

  return NextResponse.json({ success: true, allSessionsRevoked: true });
}
