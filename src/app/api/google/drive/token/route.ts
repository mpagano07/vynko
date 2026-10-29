import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getGoogleDriveAccessToken } from '@/lib/google/token-store';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const token = await getGoogleDriveAccessToken(auth.userId);
  if (!token) {
    return NextResponse.json(
      { needsAuth: true, error: 'Conectá tu cuenta de Google con permisos de Drive' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // El access token viaja al navegador porque Google Picker lo exige, pero no
  // debe quedar en ningún cache intermedio.
  return NextResponse.json(
    { accessToken: token.accessToken, expiresAt: token.expiresAt },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
