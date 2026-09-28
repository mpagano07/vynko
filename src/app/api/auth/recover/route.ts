import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * Canje del codigo de recuperacion por una sesion.
 *
 * El link de "olvide mi contrasena" llega a la app con un `?code=`. Antes lo
 * canjeaba el navegador con `supabase.auth.exchangeCodeForSession(code)`, que
 * deja el refresh token en una cookie que el JavaScript puede leer. Ahora el
 * canje ocurre aca: la cookie de sesion queda HttpOnly y el unico token que
 * existe en el cliente es el codigo de un solo uso que ya se canjeo.
 *
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
  try {
    const body = await request.json();
    code = (body as { code?: unknown } | null)?.code;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof code !== 'string' || !code || code.length > 500) {
    return NextResponse.json({ error: 'Link invalido o expirado' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data?.session) {
    return NextResponse.json({ error: 'Link invalido o expirado' }, { status: 400 });
  }

  // No se devuelve ningun token al navegador: solo confirma que la sesion de
  // recuperacion quedo establecida en una cookie HttpOnly.
  return NextResponse.json({ success: true });
}
