import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, type ServerCookie } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { getAppOrigin, safeInternalRedirect } from '@/lib/security/redirects';
import { saveGoogleDriveRefreshToken } from '@/lib/google/token-store';
import { GOOGLE_DRIVE_STATE_COOKIE, hasDriveFileScope } from '@/lib/google/oauth';

interface OAuthStateCookie {
  state?: string;
  origin?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

function statesMatch(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function withParam(target: string, key: string, value: string): string {
  const [path, query = ''] = target.split('?');
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

interface ResponseCookieOptions {
  maxAge?: number;
  path?: string;
  domain?: string;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
  httpOnly?: boolean;
}

function redirectAndClearState(
  request: Request,
  target: string,
  capturedCookies: ServerCookie[] = []
): NextResponse {
  const response = NextResponse.redirect(safeInternalRedirect(request, target));

  // Igual que en `/auth/callback` y `/api/auth/oauth`: la escritura implícita
  // de `cookies()` no se propaga de forma confiable a un GET que devuelve una
  // redirección. Si `getUser()` refrescó la sesión y perdemos esas cookies, el
  // navegador queda con el access token viejo y la siguiente llamada a la API
  // responde 401.
  for (const c of capturedCookies) {
    const opts = c.options as ResponseCookieOptions;
    if (c.value === '') {
      response.cookies.delete({ name: c.name, path: opts.path, domain: opts.domain });
    } else {
      response.cookies.set(c.name, c.value, opts);
    }
  }

  response.cookies.set(GOOGLE_DRIVE_STATE_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');
  const capturedCookies: ServerCookie[] = [];

  const cookieStore = await cookies();
  const rawState = cookieStore.get(GOOGLE_DRIVE_STATE_COOKIE)?.value;

  let stored: OAuthStateCookie | null = null;
  try {
    stored = rawState ? (JSON.parse(rawState) as OAuthStateCookie) : null;
  } catch {
    stored = null;
  }

  const destination =
    typeof stored?.origin === 'string' &&
    stored.origin.startsWith('/') &&
    !stored.origin.startsWith('//')
      ? stored.origin
      : '/products';

  if (oauthError) {
    return redirectAndClearState(request, withParam(destination, 'drive_error', 'cancelled'));
  }

  if (!code) {
    return redirectAndClearState(request, withParam(destination, 'drive_error', 'missing_code'));
  }

  // El state demuestra que este callback corresponde a un flujo iniciado desde
  // esta misma sesión del navegador (evita vincular el Drive de otra cuenta).
  if (!statesMatch(stored?.state, state)) {
    return redirectAndClearState(request, withParam(destination, 'drive_error', 'invalid_state'));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return redirectAndClearState(request, withParam(destination, 'drive_error', 'not_configured'));
  }

  try {
    const supabase = await createServerSupabaseClient({
      cookieSetAll: (cookies) => capturedCookies.push(...cookies),
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return redirectAndClearState(request, '/login?error=session_expired', capturedCookies);
    }

    const redirectUri = `${getAppOrigin(request)}/auth/google-drive/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      cache: 'no-store',
    });

    const tokens = (await tokenRes.json().catch(() => ({}))) as GoogleTokenResponse;

    if (!tokenRes.ok) {
      logger.error('Google rechazó el código de Drive:', {
        error: tokens.error ?? tokenRes.status,
        description: tokens.error_description,
      });
      return redirectAndClearState(request, withParam(destination, 'drive_error', 'token_failed'), capturedCookies);
    }

    if (!tokens.refresh_token) {
      // Con `access_type=offline` + `prompt=consent` Google debería mandarlo.
      // Si no lo hace, no podemos mantener la conexión sin volver a pedir
      // consentimiento en cada operación.
      logger.error('Google no devolvió refresh_token para Drive.');
      return redirectAndClearState(request, withParam(destination, 'drive_error', 'no_refresh_token'), capturedCookies);
    }

    if (!hasDriveFileScope(tokens.scope)) {
      // Si el usuario destildó el permiso de Drive, Google igual devuelve un
      // token, pero sin `drive.file`. Guardarlo dejaría una conexión "verde"
      // que falla después con 401/403 al abrir Picker o descargar.
      logger.error('Google no concedió el scope drive.file para Drive.', {
        scope: tokens.scope,
      });
      return redirectAndClearState(
        request,
        withParam(destination, 'drive_error', 'missing_drive_scope'),
        capturedCookies
      );
    }

    await saveGoogleDriveRefreshToken(user.id, tokens.refresh_token, tokens.scope);
    return redirectAndClearState(request, withParam(destination, 'drive_connected', 'true'), capturedCookies);
  } catch (error) {
    logger.error('Error en el callback de Google Drive:', { error });
    return redirectAndClearState(request, withParam(destination, 'drive_error', 'unknown'), capturedCookies);
  }
}
