import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  try {
    const authRoutes = ['/login', '/auth/callback', '/auth/signup', '/auth/forgot-password', '/auth/reset-password'];
    const isOnboardingRoute = request.nextUrl.pathname === '/onboarding';
    const isAuthRoute = authRoutes.includes(request.nextUrl.pathname);
    const isApiRoute = request.nextUrl.pathname.startsWith('/api/');

    const tempResponse = NextResponse.next({
      request: { headers: request.headers },
    });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              tempResponse.cookies.set({ name, value, ...options });
            });
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();

    const withCookies = (res: NextResponse): NextResponse => {
      const authCookies = tempResponse.cookies.getAll();
      authCookies.forEach((cookie) => res.cookies.set(cookie));
      return res;
    };

    if (!user && !isAuthRoute && !isOnboardingRoute && !isApiRoute) {
      return withCookies(
        NextResponse.redirect(
          new URL(`/login?redirect=${encodeURIComponent(request.nextUrl.pathname)}`, request.url)
        )
      );
    }

    if (user) {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      );

      const { data: tu, error } = await supabaseAdmin
        .from('tenant_users')
        .select('tenant_id')
        .eq('user_id', user.id);

      if (error) {
        console.error('Middleware: error fetching tenant for user', user.id, error);
      }

      const tenantId = tu?.[0]?.tenant_id;

      if (isApiRoute) {
        if (tenantId) {
          const headers = new Headers(request.headers);
          headers.set('x-tenant-id', tenantId);
          return withCookies(
            NextResponse.next({ request: { headers } })
          );
        }
        return withCookies(
          NextResponse.next({ request: { headers: request.headers } })
        );
      }

      if (!tenantId) {
        if (!isOnboardingRoute) {
          return withCookies(
            NextResponse.redirect(new URL('/onboarding', request.url))
          );
        }
        return withCookies(
          NextResponse.next({ request: { headers: request.headers } })
        );
      }

      if (isOnboardingRoute || isAuthRoute) {
        return withCookies(
          NextResponse.redirect(new URL('/', request.url))
        );
      }

      const headers = new Headers(request.headers);
      headers.set('x-tenant-id', tenantId);
      return withCookies(
        NextResponse.next({ request: { headers } })
      );
    }

    return withCookies(
      NextResponse.next({ request: { headers: request.headers } })
    );
  } catch (error) {
    console.error('Middleware error:', error);
    return NextResponse.next({ request: { headers: request.headers } });
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
