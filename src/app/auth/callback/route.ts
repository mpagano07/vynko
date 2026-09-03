import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const capturedHeaders: { name: string; value: string }[] = [];

    const supabase = await createServerSupabaseClient({
      cookieSetAll: (cookies) => {
        for (const c of cookies) {
          const parts = [`${c.name}=${c.value}`];
          if (c.maxAge !== undefined) parts.push(`Max-Age=${c.maxAge}`);
          if (c.domain) parts.push(`Domain=${c.domain}`);
          if (c.path) parts.push(`Path=${c.path}`);
          if (c.sameSite) parts.push(`SameSite=${c.sameSite}`);
          if (c.secure) parts.push('Secure');
          if (c.httpOnly) parts.push('HttpOnly');
          capturedHeaders.push({ name: 'Set-Cookie', value: parts.join('; ') });
        }
      },
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

      const response = NextResponse.redirect(redirectTo, 302);
      for (const h of capturedHeaders) {
        response.headers.append(h.name, h.value);
      }
      return response;
    } else {
      console.error('Server side callback error:', error);
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=missing_code`);
}
