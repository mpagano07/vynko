import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

export async function proxy(request: NextRequest) {
  const supabaseClient = await createServerSupabaseClient();
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('redirect_to', request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }
  // Attach tenant_id to request headers for downstream handlers
  const { data: profile } = await supabaseClient
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single();
  if (!profile?.tenant_id) {
    // If no tenant, redirect to onboarding
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }
  const response = NextResponse.next();
  response.headers.set('x-tenant-id', profile.tenant_id);
  return response;
}

export const config = {
  matcher: ['/((?!_next|api|static|public|.*\..*).*)'], // protect all non‑api routes
};
