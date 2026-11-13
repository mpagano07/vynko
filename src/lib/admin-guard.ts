import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isAdminProfile } from '@/lib/admin';
import { logger } from '@/lib/logger';

/**
 * Guard de las rutas `/api/admin/*`.
 *
 * El flag `profiles.is_admin` se resuelve con service role: no se acepta nada
 * que venga en la sesión del cliente. Fail closed, igual que
 * `/api/admin/analytics`.
 */
export async function requireAdmin(): Promise<{ userId: string } | NextResponse> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !isAdminProfile(profile)) {
    if (error) logger.error('Admin guard: no se pudo leer el perfil', { error: error.message });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return { userId: user.id };
}
