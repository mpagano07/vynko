import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({
            name,
            value: '',
            ...options,
          });
        },
      },
    }
  );

  // Refresh session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const authRoutes = ['/login', '/register', '/auth/callback'];
  const isOnboardingRoute = request.nextUrl.pathname === '/onboarding';
  const isAuthRoute = authRoutes.includes(request.nextUrl.pathname);

  // If no user and trying to access protected route, redirect to login
  if (!user && !isAuthRoute && !isOnboardingRoute) {
    return NextResponse.redirect(
      new URL(`/login?redirect=${encodeURIComponent(request.nextUrl.pathname)}`, request.url)
    );
  }

  // If user is authenticated, check tenant status
  if (user) {
    const { data: tenantUser, error: tenantError } = await supabase
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', user.id)
      .maybeSingle();

    // On DB errors (e.g., 500 from RLS during first-time setup), treat as no tenant
    const tenantId = tenantError ? null : tenantUser?.tenant_id;

    if (!tenantId) {
      // No tenant -> must complete onboarding
      if (!isOnboardingRoute) {
        return NextResponse.redirect(new URL('/onboarding', request.url));
      }
    } else {
      // User has a tenant -> cannot onboard or login again
      if (isOnboardingRoute || isAuthRoute) {
        return NextResponse.redirect(new URL('/', request.url));
      }

      // Inject the x-tenant-id header for API routes
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-tenant-id', tenantId);

      response = NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
