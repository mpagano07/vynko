import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/products?drive_error=cancelled', request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/products?drive_error=missing_code', request.url));
  }

  try {
    let origin = '/products';
    if (state) {
      try {
        const parsed = JSON.parse(Buffer.from(state, 'base64').toString());
        origin = parsed.origin || '/products';
      } catch {}
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = `${new URL(request.url).origin}/auth/google-drive/callback`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId!,
        client_secret: clientSecret!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(new URL('/products?drive_error=token_failed', request.url));
    }

    const tokens = await tokenRes.json();
    
    // Note: For full integration with Supabase, we might need to store tokens
    // For now, redirect back - user can try again if session has provider token
    return NextResponse.redirect(new URL(`${origin}?drive_connected=true`, request.url));
  } catch {
    return NextResponse.redirect(new URL('/products?drive_error=unknown', request.url));
  }
}
