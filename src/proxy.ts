import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { checkSubscriptionBlocked, consolidateOwnerSubscription, type TenantSubscription } from '@/lib/checkSubscription';

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

  // Admin client (service role) for DB checks: bypasses RLS so a policy or a
  // transient failure can never drop a user who really has a company.
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Membership check. Only redirect to onboarding on a *definitive* empty
  // result; on a query error we fail open and let the client-side /api/session
  // decide instead of sending an existing customer to onboarding.
  const { data: tenantUsers, error: membershipError } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);

  const tenantIds = tenantUsers?.map((tu) => tu.tenant_id) ?? [];

  if (membershipError) {
    console.warn('proxy: tenant_users check failed, failing open:', membershipError.message);
  } else if (!tenantIds || tenantIds.length === 0) {
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }

  // Check subscription block (skip for billing page). Every branch of the same
  // owner shares a single subscription, so the block is evaluated against the
  // owner's consolidated subscription across all their tenants.
  if (tenantIds.length > 0 && !pathname.startsWith(billingPath)) {
    const { data: tenants } = await supabaseAdmin
      .from('tenants')
      .select('subscription_status, subscription_plan, created_at, subscription_current_period_end')
      .in('id', tenantIds);

    const consolidated = consolidateOwnerSubscription(tenants as TenantSubscription[] | null);
    const result = consolidated ? checkSubscriptionBlocked(consolidated) : null;

    if (result?.blocked) {
      const url = new URL(billingPath, request.url);
      url.searchParams.set('blocked', result.reason);
      return NextResponse.redirect(url);
    }
  }

  if (tenantIds.length > 0) response.headers.set('x-tenant-id', tenantIds[0]);
  return response;
}

export const config = {
  matcher: ['/((?!_next|api|static|public|.*\..*).*)'],
};
