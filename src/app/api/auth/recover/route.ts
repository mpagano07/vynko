import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { validatePassword } from '@/lib/password-policy';
import { authErrorMessage } from '@/lib/auth-errors';

const MAX_CODE_LENGTH = 500;

/**
 * Canje del link de recuperacion: `code` + contrasena nueva, en un solo request.
 *
 * El `code` del email ES la prueba de identidad, asi que no hace falta armar una
 * sesion a mitad de camino. Antes el flujo era en dos pasos: el navegador canjeaba
 * el `code` por una sesion, y recien despues se pedia la contrasena nueva. Eso
 * dejaba abierta una sesion completa y reutilizable entre los dos pasos, con la
 * pagina de reset autorizada para cambiar la contrasena. Canjeando y aplicando
 * en el mismo request, el `code` se gasta enseguida y no queda ninguna sesion de
 * por medio:
 *
 *  1. `exchangeCodeForSession` canjea el `code` (de un solo uso) por una sesion.
 *  2. `updateUser` aplica la contrasena nueva con esa sesion.
 *  3. `signOut({ scope: 'global' })` revoca TODOS los refresh tokens.
 *
 * El paso 3 es lo que hace que serve para algo mas que para el caso feliz: si el
 * password se cambio porque se sospecha un robo de cuenta, las sesiones del
 * atacante tienen que caer. Con un logout local quedarian vivas.
 *
 * No se devuelve ningun token al navegador: la respuesta es un boolean.
 * Requiere same-origin porque opera sobre la sesion del visitante.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  const ip = getClientIp(request);
  const limit = await rateLimit(`auth:recover:ip:${ip}`, 10, 15 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Probá de nuevo más tarde.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  let code: unknown;
  let newPassword: unknown;
  try {
    const body = await request.json();
    code = (body as { code?: unknown; newPassword?: unknown } | null)?.code;
    newPassword = (body as { newPassword?: unknown } | null)?.newPassword;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof code !== 'string' || !code || code.length > MAX_CODE_LENGTH) {
    return NextResponse.json({ error: 'Link inválido o expirado' }, { status: 400 });
  }

  // La politica se chequea ANTES de canjear el codigo. El `code` es de un solo
  // uso: si se gastara en un canje que despues falla por una contrasena de 5
  // caracteres, el usuario tendria que volver a pedir el email, esperar otra vez
  // y el error se repetiria. Prefallando, el link sigue sirviendo.
  //
  // Sin el email todavia no se puede comparar contra el buzon, asi que esa parte
  // se revalida despues del canje.
  const preCheck = validatePassword(newPassword);
  if (!preCheck.ok) {
    return NextResponse.json({ error: preCheck.error }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // A partir del canje hay una sesion REAL de la cuenta en las cookies de
  // respuesta. Si cualquier salida temprana la deja viva, el visitante conserva
  // una sesion completa sin haber pasado nunca por la pantalla de login. Por eso
  // todo lo que viene despues vive en el try, y el finally revoca.
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !data?.session) {
    // Causa raiz habitual: el link se abrio en otra pestana o en otro
    // navegador, donde no esta la cookie con el `code-verifier` que se creo al
    // pedir el email. El `code` es de un solo uso, asi que no hay forma de
    // recuperarlo: hay que pedir un link nuevo.
    console.warn('Recovery code exchange failed:', exchangeError?.message);
    return NextResponse.json({ error: 'Link inválido o expirado' }, { status: 400 });
  }

  try {
    const email = data.user?.email;
    if (!email || !data.user?.email_confirmed_at) {
      // Una cuenta sin email confirmado no deberia tener recibido el link, pero
      // si llega hasta aca no se le deja cambiar la contrasena: el cambio exige
      // que la identidad este verificada.
      return NextResponse.json({ error: 'Sesión no válida' }, { status: 401 });
    }

    // Segunda pasada, ahora con el email a mano.
    const passwordCheck = validatePassword(newPassword, { email });
    if (!passwordCheck.ok) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword as string,
    });
    if (updateError) {
      return NextResponse.json({ error: authErrorMessage(updateError), linkConsumed: true }, { status: 400 });
    }

    // Revoca todas las sesiones, incluida la de recuperacion. Si esto falla, la
    // contrasena ya quedo cambiada y no se avisa error: el usuario tiene que poder
    // entrar igual.
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
    if (signOutError) {
      console.error('Recovery signOut failed:', signOutError.message);
    }

    return NextResponse.json({ success: true });
  } finally {
    // Red de seguridad: si se llego a cambiar la contrasena, el `signOut` global
    // de arriba ya revoco todo y este `local` es un no-op. Si se salio por
    // cualquier otra razon (401, 400), esta es la unica revocacion que corrio, y
    // es la que evita que quede una sesion de la cuenta viva en el navegador.
    await supabase.auth.signOut({ scope: 'local' });
  }
}
