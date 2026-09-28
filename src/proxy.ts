import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { checkSubscriptionBlocked, consolidateOwnerSubscription, type TenantSubscription } from '@/lib/checkSubscription';
import { buildCsp } from '@/lib/security/csp';
import { hardenSessionCookieOptions } from '@/lib/security/session-cookie';

const publicPaths = ['/login', '/auth', '/accept-invite', '/privacidad', '/terminos', '/cookies'];
const onboardingPath = '/onboarding';
const billingPath = '/billing';

/**
 * Empaqueta la CSP con un nonce nuevo y la propaga a la request y a la
 * respuesta.
 *
 * El nonce va en la REQUEST para que Next lo extraiga durante el render y se
 * lo agregue a los scripts que genera; y en la RESPONSE para que el navegador
 * lo exija. Next busca el nonce en el header `Content-Security-Policy`, por eso
 * se copia ahi tambien.
 *
 * `next()` conserva los request headers, asi que el nonce sigue disponible
 * para los Server Components aunque despues se devuelva una redireccion.
 */
function withCsp(response: NextResponse, nonce: string): NextResponse {
  const csp = buildCsp(nonce);
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', buildCsp(nonce));

  const next = () => {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    return withCsp(res, nonce);
  };

  const redirect = (url: URL) => withCsp(NextResponse.redirect(url), nonce);

  if (pathname === '/') return next();

  const isOnboarding = pathname === onboardingPath || pathname.startsWith(`${onboardingPath}/`);

  if (publicPaths.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return next();
  }

  const response = next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            // El proxy refresca la sesion en cada request, asi que es el segundo
            // escritor de cookies de sesion. Comparte el endurecimiento con las
            // rutas de API para que no se puedan desincronizar: si esta copia
            // reescribiera la cookie sin `httpOnly`, dejaria la sesion legible
            // desde el navegador en cada navegacion, aunque las rutas la
            // escribieran bien.
            const sessionOptions: Record<string, unknown> = { ...options };
            // Session cookies: strip maxAge/expires when setting so the browser
            // deletes them when fully closed. Deletions (empty value) keep the
            // SDK's maxAge: 0 so the cookie is actually removed.
            if (value) {
              delete sessionOptions.maxAge;
              delete sessionOptions.expires;
            }
            response.cookies.set(name, value, hardenSessionCookieOptions(sessionOptions));
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('redirect_to', pathname);
    return redirect(redirectUrl);
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
      return redirect(new URL('/dashboard', request.url));
    }
    return response;
  }

  if (membershipError) {
    console.warn('proxy: tenant_users check failed, failing open:', membershipError.message);
  } else if (onboardingPending && (!tenantIds || tenantIds.length === 0)) {
    return redirect(new URL('/onboarding', request.url));
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
      return redirect(url);
    }
  }

  if (tenantIds.length > 0) response.headers.set('x-tenant-id', tenantIds[0]);
  return response;
}

/**
 * Matcher del Proxy.
 *
 * OJO con el escapado: dentro de un string de JS, `"\."` NO es un punto
 * literal, es solo `"."` (el backslash se pierde). Eso convertia el filtro de
 * archivos con extension en `.*..*`, que matchea cualquier string no vacio:
 * el negative lookahead fallaba siempre y el Proxy terminaba ejecutandose
 * unicamente en `/`. Es decir, los gates de auth, onboarding, suscripcion y
 * refresh de sesion NO se ejecutaban en ningun build de produccion.
 * El doble backslash `\\.` si produce el punto escapado en la regex final.
 *
 * Este matcher excluye `_next`, `api`, `static`, `public` y cualquier ruta que
 * contenga un punto (assets: theme-init.js, favicon.ico, robots.txt, ...), para
 * que la logica de auth no bloquee la carga de CSS, JS e imagenes.
 *
 * `src/proxy.test.ts` verifica que estas rutas NO matchean y que las paginas
 * de la app SI, para que un error de escapado no vuelva a pasar inadvertido.
 */
export const config = {
  matcher: ['/((?!_next|api|static|public|.*\\..*).*)'],
};
