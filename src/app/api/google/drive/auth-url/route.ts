import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getAppOrigin } from '@/lib/security/redirects';
import { GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_STATE_COOKIE } from '@/lib/google/oauth';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedOrigin = searchParams.get('origin') || '/products';
  // Sólo rutas internas: el callback la usa como destino de la redirección.
  const origin =
    requestedOrigin.startsWith('/') && !requestedOrigin.startsWith('//')
      ? requestedOrigin
      : '/products';

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret || clientId === 'dummy' || clientSecret === 'dummy') {
    return NextResponse.json({ error: 'Google OAuth no configurado' }, { status: 500 });
  }

  // `drive.file` es NO sensible: la app sólo accede a los archivos que el
  // usuario elige en Google Picker. No incluir `include_granted_scopes`, porque
  // mezclaría permisos viejos (p. ej. `drive.readonly`) y volvería a exigir la
  // verificación restringida de Google.
  const redirectUri = `${getAppOrigin(request)}/auth/google-drive/callback`;
  const state = crypto.randomBytes(32).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const response = NextResponse.json({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  });

  // El state queda atado a esta sesión con una cookie HttpOnly. Sin esto, un
  // atacante podría hacer que la víctima complete un callback con SU código de
  // Google y dejar la cuenta de Drive del atacante vinculada a la víctima.
  response.cookies.set(GOOGLE_DRIVE_STATE_COOKIE, JSON.stringify({ state, origin }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  });

  return response;
}
