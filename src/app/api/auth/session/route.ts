import { NextResponse } from 'next/server';
import { createServerSupabaseClient, type ServerCookie } from '@/lib/supabase';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { LAST_SEEN_COOKIE, LAST_SEEN_COOKIE_OPTIONS } from '@/lib/session-policy';

interface ResponseCookieOptions {
  maxAge?: number;
  path?: string;
  domain?: string;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
  httpOnly?: boolean;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  const ip = getClientIp(request);
  const limit = await rateLimit(`auth:session-token:ip:${ip}`, 30, 15 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json({ error: 'Demasiados intentos' }, { status: 429 });
  }

  let access_token: unknown;
  let refresh_token: unknown;
  try {
    const body = await request.json();
    access_token = (body as Record<string, unknown> | null)?.access_token;
    refresh_token = (body as Record<string, unknown> | null)?.refresh_token;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (typeof access_token !== 'string' || typeof refresh_token !== 'string' || !access_token || !refresh_token) {
    return NextResponse.json({ error: 'Tokens requeridos' }, { status: 400 });
  }

  const capturedCookies: ServerCookie[] = [];
  const supabase = await createServerSupabaseClient({
    cookieSetAll: (cookies) => capturedCookies.push(...cookies),
  });

  const { data, error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });

  if (error || !data.session) {
    return NextResponse.json({ error: 'Sesión inválida o expirada' }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(LAST_SEEN_COOKIE, String(Date.now()), LAST_SEEN_COOKIE_OPTIONS);
  for (const c of capturedCookies) {
    const opts = c.options as Partial<ResponseCookieOptions>;
    if (c.value === '') {
      response.cookies.delete({
        name: c.name,
        path: opts.path,
        domain: opts.domain,
      });
    } else {
      response.cookies.set(c.name, c.value, opts);
    }
  }
  return response;
}

