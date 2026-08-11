import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { checkSubscriptionBlocked } from '@/lib/checkSubscription';

const publicPaths = ['/login', '/auth', '/onboarding', '/accept-invite'];
const billingPath = '/billing';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/') return NextResponse.next();

  if (publicPaths.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const response = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('redirect_to', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  const { data: tenantUsers } = await supabase
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);

  const tenantId = tenantUsers?.[0]?.tenant_id;

  if (!tenantId) {
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }

  // Check subscription block (skip for billing page)
  if (!pathname.startsWith(billingPath)) {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('subscription_status, subscription_plan, created_at, subscription_current_period_end')
      .eq('id', tenantId)
      .single();

    if (tenant) {
      const result = checkSubscriptionBlocked(tenant);
      if (result.blocked) {
        const url = new URL(billingPath, request.url);
        url.searchParams.set('blocked', result.reason);
        return NextResponse.redirect(url);
      }
    }
  }

  response.headers.set('x-tenant-id', tenantId);
  return response;
}

export const config = {
  matcher: ['/((?!_next|api|static|public|.*\..*).*)'],
};
