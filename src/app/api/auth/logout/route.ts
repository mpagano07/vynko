import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { LAST_SEEN_COOKIE, LAST_SEEN_COOKIE_OPTIONS } from '@/lib/session-policy';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Logout desde el servidor.
 *
 * El cliente ya no necesita `supabase.auth.signOut()`: cuando la cookie de
 * sesión pase a ser HttpOnly, JS no puede modificarla y el borrado tiene que
 * hacerlo el servidor. Este endpoint es ese borrado.
 *
 * `signOut()` revoca el refresh token en Supabase, no solo la cookie local, asi
 * que una cookie robada deja de servir aunque siga vigente.
 *
 * Tambien borra `vynko_last_seen`. Sin esto, el logout dejaba vivo el timestamp
 * de la ultima peticion: si el usuario se iba mas de 30 minutos y volvia a
 * loguearse, el primer request que atraviesa el proxy comparaba ese timestamp
 * viejo contra el plazo de inactividad, lo dava por vencido y lo expulsaba con
 * `reason=inactive` en el mismo instante en que acababa de autenticarse. O sea,
 * "tu sesion expiro por inactividad" a alguien que recien acaba de entrar.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  try {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut({ scope: 'local' });
  } catch (error) {
    // El logout es idempotente: si la sesion ya estaba caida, el usuario igual
    // queda deslogueado del lado del cliente. No hace falta fallar el request.
    logger.error('Error in POST /api/auth/logout:', { error });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(LAST_SEEN_COOKIE, '', { ...LAST_SEEN_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
