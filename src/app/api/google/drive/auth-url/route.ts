import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const origin = searchParams.get('origin') || '/products';

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret || clientId === 'dummy' || clientSecret === 'dummy') {
    return NextResponse.json({ error: 'Google OAuth no configurado' }, { status: 500 });
  }

  // Build OAuth URL with Drive scopes
  const redirectUri = `${new URL(request.url).origin}/auth/google-drive/callback`;
  const scope = 'openid email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file';
  
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scope,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: Buffer.from(JSON.stringify({ origin, userId: auth.userId })).toString('base64'),
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  
  return NextResponse.json({ url: authUrl });
}
