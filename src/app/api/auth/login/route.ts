import { NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isSameOriginRequest } from '@/lib/security/csrf';

const MAX_FAILED_ATTEMPTS = 5;
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

  const ipLimit = await rateLimit(`auth:login:ip:${ip}`, 20, WINDOW_MS);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Probá de nuevo más tarde.' },
      { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) } }
    );
  }

  const accountLimit = await rateLimit(`auth:login:account:${normalizedEmail}:${ip}`, MAX_FAILED_ATTEMPTS, WINDOW_MS);
  if (!accountLimit.ok) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Probá de nuevo más tarde.' },
      { status: 429, headers: { 'Retry-After': String(accountLimit.retryAfterSeconds) } }
    );
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (error) {
    console.warn(`Login failed for ${normalizedEmail}: ${error.message}`);
    return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 });
  }

  return NextResponse.json({ success: true });
}
