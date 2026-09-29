import { NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { safeInternalRedirect } from '@/lib/security/redirects';
import { validatePassword } from '@/lib/password-policy';
import { classifyAuthFailure } from '@/lib/auth-errors';
import { trackEvent } from '@/lib/track-event';

const MAX_IP_ATTEMPTS = 10;
const MAX_EMAIL_ATTEMPTS = 3;
const WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  let email: unknown;
  let password: unknown;
  let companyName: unknown;
  let ownerName: unknown;
  try {
    const body = await request.json();
    email = (body as { email?: unknown } | null)?.email;
    password = (body as { password?: unknown } | null)?.password;
    companyName = (body as { companyName?: unknown } | null)?.companyName;
    ownerName = (body as { fullName?: unknown } | null)?.fullName;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
  }
  if (typeof companyName !== 'string' || typeof ownerName !== 'string' || !companyName || !ownerName) {
    return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
  }
  if (email.length > 320 || password.length > 200 || companyName.length > 200 || ownerName.length > 200) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const ip = getClientIp(request);

  // La politica vive en un modulo compartido con los otros tres caminos que
  // escriben una contrasena. Se valida antes de gastar presupuesto del limite
  // para no consumirle los cupos al usuario por escribir mal.
  const passwordCheck = validatePassword(password, { email: normalizedEmail });
  if (!passwordCheck.ok) {
    return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
  }

  const ipLimit = await rateLimit(`auth:signup:ip:${ip}`, MAX_IP_ATTEMPTS, WINDOW_MS);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: 'Demasiados registros desde esta conexión. Probá más tarde.' },
      { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) } }
    );
  }

  const emailLimit = await rateLimit(`auth:signup:email:${normalizedEmail}`, MAX_EMAIL_ATTEMPTS, WINDOW_MS);
  if (!emailLimit.ok) {
    return NextResponse.json(
      { error: 'Demasiados registros para este email. Probá más tarde.' },
      { status: 429, headers: { 'Retry-After': String(emailLimit.retryAfterSeconds) } }
    );
  }

  const redirectTo = safeInternalRedirect(
    request,
    `/auth/callback?company_name=${encodeURIComponent(companyName.trim())}&full_name=${encodeURIComponent(ownerName.trim())}`,
    '/dashboard'
  );

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      data: {
        company_name: companyName.trim(),
        full_name: ownerName.trim(),
      },
      emailRedirectTo: redirectTo,
    },
  });

  if (error) {
    console.warn(`Signup failed for ${normalizedEmail}: ${error.message}`);

    // "Ya existe" se responde como un alta mas. GoTrue ofusca el alta repetida
    // cuando la confirmacion de email esta activa (devuelve el usuario con
    // `identities` vacio y sin error), pero con la confirmacion desactivada
    // devuelve un error explicito. Depender de una configuracion del panel para
    // no filtrar que emails existen es frágil: la ofuscacion tiene que estar
    // en la ruta, porque es la ruta la que decide que se responde.
    if (error.code === 'user_already_exists' || /already (been )?registered|already exists/i.test(error.message)) {
      return NextResponse.json({ success: true, requiresConfirmation: true });
    }

    const classified = classifyAuthFailure(error, 'No se pudo crear la cuenta');
    return NextResponse.json(
      { error: classified.message },
      {
        status: classified.status,
        headers: classified.retryAfterSeconds
          ? { 'Retry-After': String(classified.retryAfterSeconds) }
          : undefined,
      }
    );
  }

  // Cuando el email ya existe con la confirmacion activa, Supabase no abre sesion
  // y devuelve el usuario con `identities` vacio. Antes eso se traducía en un 409
  // "Este email ya esta registrado", que confirma las cuentas dadas de alta: con
  // solo eso, cualquiera puede scopar si una direccion esta en el sistema. Se
  // responde lo mismo que en el caso exitoso, asi que no se puede distinguir, y el
  // frontend muestra el cartel de "revisá tu email" para los dos casos.
  //
  // `data.user` es null justamente en ese caso de alta repetida, asi que el
  // evento de analytics sale del if justamente: si no hay user, no hay
  // registro nuevo que contar. El evento se graba igual cuando la cuenta
  // queda pendiente de confirmar: una persona que se registra y nunca
  // confirma es una fuga del embudo, y para verla hay que registrarla.
  if (data?.user?.id) {
    await trackEvent({
      type: 'signup',
      userId: data.user.id,
      userEmail: data.user.email ?? normalizedEmail,
      userName: ownerName.trim(),
      metadata: { requiresConfirmation: !data.session, via: 'email' },
    });
  }

  return NextResponse.json({ success: true, requiresConfirmation: !data?.session });
}
