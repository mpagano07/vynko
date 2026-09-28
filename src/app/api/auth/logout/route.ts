import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isSameOriginRequest } from '@/lib/security/csrf';

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
    console.error('Error in POST /api/auth/logout:', error);
  }

  return NextResponse.json({ success: true });
}
