import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { checkSubscriptionBlocked, consolidateOwnerSubscription, type TenantSubscription } from '@/lib/checkSubscription';
import { buildCsp } from '@/lib/security/csp';
import { hardenSessionCookieOptions } from '@/lib/security/session-cookie';
import {
  INACTIVITY_TIMEOUT_MS,
  LAST_SEEN_COOKIE,
  LAST_SEEN_COOKIE_OPTIONS,
} from '@/lib/session-policy';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const publicPaths = [
  '/login',
  '/auth',
  '/accept-invite',
  '/sin-acceso',
  '/privacidad',
  '/terminos',
  '/cookies',
];
const onboardingPath = '/onboarding';
const billingPath = '/billing';

// Tope global de requests de PAGINA por IP por minuto, aplicado aca, en el
// proxy, para las rutas autenticadas (el matcher excluye /api, que ya tiene
// sus propios limites por endpoint).
//
// Es un limite GENEROSO a proposito: una persona normal genera decenas de
// requests por minuto solo con navegar (la carga de la pagina, el prefetch de
// Next y cada request RSC pasan por aca), y una oficina completa suele salir
// detras de la MISMA IP compartida. El objetivo es frenar un bucle de requests
// o un scrape de paginas, no modular el uso humano; si este tope llegara a
// tocarse, es mas probable que haya un bug en el cliente que un abuso.
const PROXY_IP_LIMIT = 6000;
const PROXY_IP_WINDOW_MS = 60_000;

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

  if (pathname === '/') return next();

  const isOnboarding = pathname === onboardingPath || pathname.startsWith(`${onboardingPath}/`);

  if (publicPaths.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return next();
  }

  const response = next();

  // `next()` y `redirect()` son respuestas distintas, y las cookies que escribe
  // el cliente de Supabase (refresh de token, borrado al cerrar sesion) se
  // acumulan en `response`. Sin volcarlas, una redireccion perderia el refresh
  // que se acaba de hacer, y en el camino de cerrar sesion no se borraria la
  // cookie: el usuario "deslogueado" seguiria entrando.
  const carryingCookies = (res: NextResponse): NextResponse => {
    for (const cookie of response.cookies.getAll()) res.cookies.set(cookie);
    return res;
  };

  const redirectWithCookies = (url: URL) =>
    withCsp(carryingCookies(NextResponse.redirect(url)), nonce);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
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
    return redirectWithCookies(redirectUrl);
  }

  // Rate limit global de paginas, solo para sesiones validas. Se usa la IP real
  // (`getClientIp` respeta los headers del edge y no acepta el `x-forwarded-for`
  // que arma el cliente) y el store distribuido cuando hay mas de una instancia.
  // Se bloquea con 429 y `Retry-After` para que el cliente (o el navegador)
  // sepa cuanto esperar.
  const ipLimit = await rateLimit(
    `proxy:ip:${getClientIp(request)}`,
    PROXY_IP_LIMIT,
    PROXY_IP_WINDOW_MS
  );

  if (!ipLimit.ok) {
    return withCsp(
      NextResponse.json(
        { error: 'Demasiadas peticiones desde esta conexión. Esperá unos segundos y volvé a intentar.' },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) } }
      ),
      nonce
    );
  }

  // Cierre por inactividad, aplicado aca y no solo en el navegador.
  //
  // El timeout del cliente (localStorage + un timer de JS) es una ayuda para la
  // experience, pero no es un control de seguridad: una cookie robada no ejecuta
  // ese codigo, y el refresh token se renueva desde el servidor mientras el
  // atacante navegue. El plazo se comprueba aca, con un timestamp en una cookie
  // HttpOnly que el usuario no puede editar, y al vencer se revoca la sesion en
  // Supabase en vez de solo_clean la cookie local.
  const lastSeenRaw = request.cookies.get(LAST_SEEN_COOKIE)?.value;
  const lastSeen = lastSeenRaw ? Number.parseInt(lastSeenRaw, 10) : Number.NaN;

  if (Number.isFinite(lastSeen) && Date.now() - lastSeen > INACTIVITY_TIMEOUT_MS) {
    await supabase.auth.signOut({ scope: 'local' });
    response.cookies.set(LAST_SEEN_COOKIE, '', { ...LAST_SEEN_COOKIE_OPTIONS, maxAge: 0 });
    const inactiveUrl = new URL('/login', request.url);
    inactiveUrl.searchParams.set('reason', 'inactive');
    return redirectWithCookies(inactiveUrl);
  }

  response.cookies.set(LAST_SEEN_COOKIE, String(Date.now()), LAST_SEEN_COOKIE_OPTIONS);

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
      logger.warn('proxy: onboarding gate membership check failed, failing open:', { error: membershipError.message });
      return response;
    }
    if (!onboardingPending || tenantIds.length > 0) {
      return redirectWithCookies(new URL('/dashboard', request.url));
    }
    return response;
  }

  // OJO: aca NO se redirige a `/sin-acceso` cuando `tenant_users` viene vacio y el
  // onboarding ya esta completado. `tenant_users` es el unico origen de
  // membresia del schema, asi que una lectura vacia es indistinguible de "lo
  // sacaron de todos los tenants": con una lectura transitoria (lag de replica,
  // un RLS que falla un instante, la ventana entre completar el onboarding e
  // insertar la fila) expulsar desde aca le muestra a un cliente que tiene
  // empresa un cartel de "pedile a un owner que te vuelva a invitar".
  //
  // El caso se resuelve en el guard de cliente, que decide sobre `/api/session`:
  // una segunda lectura, con la pagina ya cargada. Ahi expulsar es seguro.
  if (membershipError) {
    logger.warn('proxy: tenant_users check failed, failing open:', { error: membershipError.message });
  } else if (onboardingPending && (!tenantIds || tenantIds.length === 0)) {
    return redirectWithCookies(new URL('/onboarding', request.url));
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
      return redirectWithCookies(url);
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
