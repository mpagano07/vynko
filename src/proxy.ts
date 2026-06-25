import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { checkSubscriptionBlocked } from '@/lib/checkSubscription';

const publicPaths = ['/login', '/auth', '/onboarding', '/accept-invite'];
const unprotectedPaths = ['/billing'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/') return NextResponse.next();

  if (publicPaths.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('redirect_to', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  const { data: profile } = await supabase
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single();

  if (!profile?.tenant_id) {
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }

  if (unprotectedPaths.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    const response = NextResponse.next();
    response.headers.set('x-tenant-id', profile.tenant_id);
    return response;
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('subscription_status, subscription_plan, created_at, subscription_current_period_end')
    .eq('id', profile.tenant_id)
    .single();

  const result = checkSubscriptionBlocked(tenant as any);

  if (result.blocked) {
    const url = new URL('/billing', request.url);
    url.searchParams.set('blocked', result.reason);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  response.headers.set('x-tenant-id', profile.tenant_id);
  return response;
}

export const config = {
  matcher: ['/((?!_next|api|static|public|.*\..*).*)'],
};
