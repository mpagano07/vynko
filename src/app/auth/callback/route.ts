import { NextResponse } from 'next/server';
import { createServerSupabaseClient, type ServerCookie } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

interface ResponseCookieOptions {
  maxAge?: number;
  path?: string;
  domain?: string;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
  httpOnly?: boolean;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const capturedCookies: ServerCookie[] = [];

    const supabase = await createServerSupabaseClient({
      cookieSetAll: (cookies) => capturedCookies.push(...cookies),
    });

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      let redirectTo = `${origin}/dashboard`;

      const userId = data.user?.id;
      if (userId) {
        const { data: tenantUsers, error: membershipError } = await supabaseAdmin
          .from('tenant_users')
          .select('tenant_id')
          .eq('user_id', userId);

        if (!membershipError && (!tenantUsers || tenantUsers.length === 0)) {
          redirectTo = `${origin}/onboarding`;
        }
      }

      const response = NextResponse.redirect(redirectTo);
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
    } else {
      console.error('Server side callback error:', error);
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=missing_code`);
}
