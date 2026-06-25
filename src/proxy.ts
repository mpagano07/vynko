import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const publicPaths = ['/login', '/auth', '/onboarding', '/accept-invite'];
const unprotectedPaths = ['/billing'];

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

  const { data: profile } = await supabase
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single();

  if (!profile?.tenant_id) {
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }

  if (unprotectedPaths.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    response.headers.set('x-tenant-id', profile.tenant_id);
    return response;
  }

  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;

  if (accessToken) {
    try {
      const checkRes = await fetch(new URL('/api/check-access', request.url), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (checkRes.ok) {
        const result = await checkRes.json();
        if (result.blocked) {
          const url = new URL('/billing', request.url);
          url.searchParams.set('blocked', result.reason || 'payment_past_due');
          return NextResponse.redirect(url);
        }
      }
    } catch {
      // Fall through — allow access if check fails
    }
  }

  response.headers.set('x-tenant-id', profile.tenant_id);
  return response;
}

export const config = {
  matcher: ['/((?!_next|api|static|public|.*\..*).*)'],
};
