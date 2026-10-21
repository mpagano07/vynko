import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { updateProfile } from '@/lib/settings-service';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { logger } from '@/lib/logger';

export async function PATCH(request: Request) {
  try {
    // Mutacion del perfil: se rechaza si el navegador la dispara desde otro
    // origen (CSRF). Las cookies de sesion son SameSite=Lax, asi que el POST
    // cross-site ya viaja sin credenciales; esto es la segunda barrera.
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();

    const result = await updateProfile(user, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data);
  } catch (err) {
    logger.error('Error updating profile:', { error: err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
