import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    // Not a PKCE callback — redirect to login with error
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  // Build response so we can set cookies on it
  const response = NextResponse.redirect(`${origin}/onboarding`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  // Exchange the PKCE code for a session — this sets the session cookies
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data?.user) {
    console.error('Code exchange error:', error?.message);
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  // Check if user already has a tenant
  const { data: tenantUser } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (tenantUser?.tenant_id) {
    // Existing user with tenant → go to dashboard
    response.headers.set('location', `${origin}/`);
  }
  // else → stays redirect to /onboarding (already set above)

  return response;
}
