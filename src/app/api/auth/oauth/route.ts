import { NextResponse } from 'next/server';
import { createServerSupabaseClient, type ServerCookie } from '@/lib/supabase';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { getAppOrigin, safeInternalRedirect } from '@/lib/security/redirects';

// Lista explicita en vez de pasar el provider que pida el cliente: si se
// aceptara cualquiera, un atacante podria usar este endpoint como generador de
// URLs de autorizacion hacia un provider arbitrario.
const ALLOWED_PROVIDERS = new Set(['google', 'github']);

/**
 * Inicio del flujo OAuth.
 *
 * Antes el navegador llamaba `supabase.auth.signInWithOAuth()`, que ademas de
 * dejar el verifier PKCE en una cookie legible por JavaScript, requires que el
 * proyecto exponga `flowType: 'pkce'` con el exchange en cliente. Moviendolo al
 * servidor, el verifier queda en la cookie del cliente SSR y el canje final lo
 * hace `/auth/callback`, que ya era una ruta de servidor.
 *
 * Se responde con la URL de autorizacion en lugar de redirigir desde aca para
 * que el cliente pueda validar que el provider fue aceptado y mostrar un error
 * en vez de navegar a un destino inesperado.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get('provider');

  if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'Proveedor no soportado' }, { status: 400 });
  }

  const ip = getClientIp(request);
  const limit = await rateLimit(`auth:oauth:ip:${ip}`, 20, 15 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Probá de nuevo más tarde.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const origin = getAppOrigin(request);
  const next = safeInternalRedirect(request, searchParams.get('next'), '/dashboard');
  // El callback recibe solo rutas internas, nunca una URL absoluta enviada por
  // el cliente, para que no se pueda usar como redirector abierto.
  const callbackPath = `/auth/callback?next=${encodeURIComponent(nextPath(next))}`;

  // El verifier PKCE se escribe como cookie. Se captura y se aplica al response
  // a mano, igual que en `/auth/callback`, para no depender de que la escritura
  // implicitamente en `cookies()` se propague en un GET.
  const capturedCookies: ServerCookie[] = [];
  const supabase = await createServerSupabaseClient({
    cookieSetAll: (cookies) => capturedCookies.push(...cookies),
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider as 'google' | 'github',
    options: { redirectTo: `${origin}${callbackPath}` },
  });

  if (error || !data?.url) {
    return NextResponse.json({ error: 'No se pudo iniciar el login con el proveedor' }, { status: 502 });
  }

  const response = NextResponse.json({ url: data.url });
  for (const c of capturedCookies) {
    const opts = c.options as ResponseCookieOptions;
    if (c.value === '') {
      response.cookies.delete({ name: c.name, path: opts.path, domain: opts.domain });
    } else {
      response.cookies.set(c.name, c.value, opts);
    }
  }
  return response;
}

interface ResponseCookieOptions {
  maxAge?: number;
  path?: string;
  domain?: string;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
  httpOnly?: boolean;
}

/** Reduce una URL ya validada a su ruta interna, para mandarla como query. */
function nextPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '/dashboard';
  }
}
