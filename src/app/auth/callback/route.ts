import { NextResponse } from 'next/server';
import { createServerSupabaseClient, type ServerCookie } from '@/lib/supabase';
import { acceptInvitationsForUser, getUserTenantIds } from '@/lib/accept-invitations';
import { createCompanyForUser } from '@/lib/create-company';
import { getAppOrigin, safeInternalRedirect } from '@/lib/security/redirects';

export const dynamic = 'force-dynamic';

interface ResponseCookieOptions {
  maxAge?: number;
  path?: string;
  domain?: string;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
  httpOnly?: boolean;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = getAppOrigin(request);
  const code = searchParams.get('code');

  if (!code) {
    // Los emails de invitación (magic link / invite) usan el flujo implícito:
    // la sesión llega en el fragmento (`#access_token=...`), que el servidor no
    // recibe. Se deriva a `/auth/magic`, que canjea los tokens en el navegador.
    // El navegador conserva el fragmento al seguir un redirect cuyo `Location`
    // no trae uno, así también funcionan los links viejos que apuntaban acá.
    const magicUrl = new URL('/auth/magic', origin);
    const requestedNext = searchParams.get('next');
    if (requestedNext) magicUrl.searchParams.set('next', requestedNext);
    return NextResponse.redirect(magicUrl);
  }

  const capturedCookies: ServerCookie[] = [];

  const supabase = await createServerSupabaseClient({
    cookieSetAll: (cookies) => capturedCookies.push(...cookies),
  });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // El code verifier se pierde si se limpió el storage entre el registro y la
    // confirmación (o si se abrió en otro navegador). El email ya quedó
    // confirmado en ese caso, así que lo mandamos a /login para que ingrese con
    // su email y contraseña.
    console.error('Server side callback error:', error.message);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('Link inválido o expirado. Ingresá con tu email y contraseña.')}`);
  }

  const user = data.user;
  let redirectPath = '/dashboard';

  // La pantalla de invitación acepta la invitación y pide nombre/contraseña.
  // Si el callback la aceptara antes, la página vería `accepted = 0` y mandaría
  // al dashboard sin dejar completar el perfil. Por eso los links de invitación
  // llegan acá con `next=/accept-invite` y el canje de la sesión se hace igual,
  // pero la aceptación queda para la página.
  const requestedNext = searchParams.get('next');
  const deferredAccept = requestedNext === '/accept-invite';

  if (user?.id && !deferredAccept) {
    // 1. Acepta invitaciones pendientes (idempotente).
    await acceptInvitationsForUser({ id: user.id, email: user.email });

    // 2. ¿Ya tiene empresa (propia o por invitación)?
    const tenantIds = await getUserTenantIds(user.id);

    if (tenantIds.length === 0) {
      // 3. Sin empresa: si el usuario se registró con nombre/empresa
      //    (email+password), la creamos acá para caer directo al dashboard.
      //    Sino (Google), va a onboarding.
      const meta = (user.user_metadata as Record<string, unknown>) ?? {};
      let companyName = typeof meta.company_name === 'string' ? meta.company_name : '';
      let ownerName = typeof meta.full_name === 'string' ? meta.full_name : '';

      // Fallback: los datos también viajan como query params en el email de
      // confirmación (más confiable si la metadata de la cuenta ya existente
      // no se actualizó).
      if (!companyName) companyName = (searchParams.get('company_name') ?? '').slice(0, 200);
      if (!ownerName) ownerName = (searchParams.get('full_name') ?? '').slice(0, 200);

      // Aplicado a user_metadata: la metadata puede quedar vacía para cuentas
      // existentes que no guardaron datos al registrarse. La actualizamos para
      // que el perfil quede completo.
      if (companyName && ownerName) {
        const tenantId = await createCompanyForUser(
          { id: user.id, email: user.email },
          companyName,
          ownerName
        );
        redirectPath = tenantId ? '/dashboard' : '/onboarding';
      } else {
        redirectPath = '/onboarding';
      }
    }
  }

  // `next` sólo se acepta si es un path interno del propio origen: evita
  // open redirect con un enlace de confirmación manipulado.
  if (requestedNext) {
    redirectPath = new URL(safeInternalRedirect(request, requestedNext, '/dashboard')).pathname;
  }

  const response = NextResponse.redirect(safeInternalRedirect(request, redirectPath));
  for (const c of capturedCookies) {
    const opts = c.options as Partial<ResponseCookieOptions>;
    if (c.value === '') {
      response.cookies.delete({
        name: c.name,
        path: opts.path,
        domain: opts.domain,
      });
    } else {
      response.cookies.set(c.name, c.value, opts);
    }
  }
  return response;
}
