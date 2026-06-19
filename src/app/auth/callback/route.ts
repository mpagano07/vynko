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

  const { data: pendingInvites } = await supabaseAdmin
    .from('invitations')
    .select('id, tenant_id, role')
    .eq('email', data.user.email?.toLowerCase() || '')
    .is('accepted_at', null);

  if (pendingInvites && pendingInvites.length > 0) {
    let acceptedTenant: string | null = null;
    for (const inv of pendingInvites) {
      await supabaseAdmin.from('profiles').upsert(
        { id: data.user.id, email: data.user.email, tenant_id: inv.tenant_id },
        { onConflict: 'id' }
      );
      const { error: tuErr } = await supabaseAdmin.from('tenant_users').upsert(
        { tenant_id: inv.tenant_id, user_id: data.user.id, role: inv.role },
        { onConflict: 'tenant_id,user_id' }
      );
      if (!tuErr) {
        acceptedTenant = inv.tenant_id;
        await supabaseAdmin.from('invitations')
          .update({ accepted_at: new Date().toISOString() })
          .eq('id', inv.id);
      }
    }
    if (acceptedTenant) {
      response.headers.set('location', `${origin}/`);
      return response;
    }
  }

  const { data: tenantUsers } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', data.user.id);

  const tenantUser = tenantUsers?.[0];
  if (tenantUser?.tenant_id) {
    response.headers.set('location', `${origin}/`);
  }

  return response;
}
