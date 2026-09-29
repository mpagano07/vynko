import { NextResponse } from 'next/server';
import { rateLimit, rateLimitPeek, getClientIp } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isSameOriginRequest } from '@/lib/security/csrf';

const MAX_FAILED_ATTEMPTS = 5;
/**
 * Techo por IP para frenar el barrido de muchas cuentas desde una misma maquina.
 * Mas alto que el de cuenta a proposito: el limite de cuenta es el que protege a
 * una victima concreta, y este solo evita que un atacante pruebe 5 contrasenas
 * por cuenta contra cientos de correos.
 */
const MAX_FAILED_ATTEMPTS_PER_IP = 20;
const WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  let email: unknown;
  let password: unknown;
  try {
    const body = await request.json();
    email = (body as { email?: unknown } | null)?.email;
    password = (body as { password?: unknown } | null)?.password;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return NextResponse.json({ error: 'Credenciales incompletas' }, { status: 400 });
  }
  if (email.length > 320 || password.length > 200) {
    return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const ip = getClientIp(request);
  const ipKey = `auth:login:ip:${ip}`;
  // La clave de cuenta NO lleva la IP. Con la IP adentro, el limite por cuenta
  // era en realidad "5 intentos contra esta cuenta desde esta maquina", y un
  // atacante con una botnet la esquivaba rotando origen: la proteccion que
  // importa es justamente la que frena a quien va contra una victima concreta.
  // El techo por IP sigue existiendo como filtro separado.
  const accountKey = `auth:login:account:${normalizedEmail}`;

  // Se consulta el limite SIN incrementarlo: el contador sube mas abajo, solo si
  // la autenticacion falla. Incrementarlo aca hacia que un login exitoso gastara
  // presupuesto, y con el limite en 5 el sexto login correcto de la misma IP
  // recibia 429. Para un usuario detras de una IP compartida eso es un bloqueo
  // sin haber fallado nunca una credencial.
  const [ipLimit, accountLimit] = await Promise.all([
    rateLimitPeek(ipKey, MAX_FAILED_ATTEMPTS_PER_IP),
    rateLimitPeek(accountKey, MAX_FAILED_ATTEMPTS),
  ]);

  const blocked = !ipLimit.ok ? ipLimit : !accountLimit.ok ? accountLimit : null;
  if (blocked) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Probá de nuevo más tarde.' },
      { status: 429, headers: { 'Retry-After': String(blocked.retryAfterSeconds) } }
    );
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (error) {
    // Aca si: un intento fallido es lo que consume presupuesto.
    await Promise.all([
      rateLimit(ipKey, MAX_FAILED_ATTEMPTS_PER_IP, WINDOW_MS),
      rateLimit(accountKey, MAX_FAILED_ATTEMPTS, WINDOW_MS),
    ]);
    console.warn(`Login failed for ${normalizedEmail}: ${error.message}`);

    // Un unico caso se distingue del resto: cuando el email existe pero todavia
    // no esta verificado. Decirlo no revela si la cuenta esta registrada (el
    // visitante ya escribio esa direccion y es la suya) y evita el callejon sin
    // salida de un 401 generico que el usuario no sabe interpretar.
    if (error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message)) {
      return NextResponse.json(
        { error: 'Confirmá tu email para poder iniciar sesión. Revisá la casilla de entrada.' },
        { status: 403 }
      );
    }

    return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 });
  }

  return NextResponse.json({ success: true });
}
