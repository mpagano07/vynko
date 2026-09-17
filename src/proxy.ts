import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { checkSubscriptionBlocked, consolidateOwnerSubscription, type TenantSubscription } from '@/lib/checkSubscription';

const publicPaths = ['/login', '/auth', '/accept-invite'];
const onboardingPath = '/onboarding';
const billingPath = '/billing';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/') return NextResponse.next();

  const isOnboarding = pathname === onboardingPath || pathname.startsWith(`${onboardingPath}/`);

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
          cookiesToSet.forEach(({ name, value, options }) => {
            // Session cookies: strip maxAge/expires when setting so the browser
            // deletes them when fully closed. Deletions (empty value) keep the
            // SDK's maxAge: 0 so the cookie is actually removed.
            const sessionOptions = { ...options };
            if (value) {
              delete sessionOptions.maxAge;
              delete sessionOptions.expires;
            }
            response.cookies.set(name, value, sessionOptions);
          });
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

  // Flag directo en el perfil: FALSE = onboarding completado (nunca
  // mostrar). TRUE o perfil inexistente (usuario recién registrado) =
  // pendiente. El redirect exige además membresías definitivamente vacías,
  // así un invitee o un fallo transitorio jamás termina frente al onboarding.
  const { data: profileRow } = await supabaseAdmin
    .from('profiles')
    .select('onboarding_pending')
    .eq('id', user.id)
    .maybeSingle();

  const onboardingPending = profileRow?.onboarding_pending !== false;

  // Bloqueo server-side de /onboarding: la ruta queda reservada exclusivamente
  // a usuarios nuevos (flag pendiente Y sin membresías). Si el usuario ya
  // completó el onboarding o tiene empresa, no llega al formulario ni ve el
  // estado "Verificando tu cuenta": se lo redirige al dashboard de una.
  if (isOnboarding) {
    if (membershipError) {
      // Chequeo ambiguo: fail open y que el guard cliente (/api/session)
      // decida. Nunca mostrar el formulario ante un resultado indeterminado.
      console.warn('proxy: onboarding gate membership check failed, failing open:', membershipError.message);
      return response;
    }
    if (!onboardingPending || tenantIds.length > 0) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return response;
  }

  if (membershipError) {
    console.warn('proxy: tenant_users check failed, failing open:', membershipError.message);
  } else if (onboardingPending && (!tenantIds || tenantIds.length === 0)) {
    return NextResponse.redirect(new URL('/onboarding', request.url));
  }

  // Self-healing: el flag quedó en TRUE pero el usuario ya tiene empresa
  // (invitación aceptada, carrera de creación, datos previos a la
  // migración). Lo alineamos para que próximos chequeos sean directos.
  if (onboardingPending && tenantIds.length > 0) {
    supabaseAdmin
      .from('profiles')
      .update({ onboarding_pending: false })
      .eq('id', user.id)
      .then(
        () => undefined,
        () => undefined
      );
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
