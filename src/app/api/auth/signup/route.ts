import { NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { safeInternalRedirect } from '@/lib/security/redirects';

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
    return NextResponse.json({ error: 'No se pudo crear la cuenta' }, { status: 400 });
  }

  const alreadyRegistered = data?.user?.identities?.length === 0;
  if (alreadyRegistered) {
    return NextResponse.json(
      { error: 'Este email ya está registrado. Usá "Olvidé mi contraseña" para acceder.' },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true, requiresConfirmation: !data?.session });
}
