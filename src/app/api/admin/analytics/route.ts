import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isAdminProfile } from '@/lib/admin';
import { getAdminAnalytics } from '@/lib/analytics-service';
import { logger } from '@/lib/logger';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // El flag se lee con service_role y no desde la sesion del cliente: `is_admin`
  // no es escribible por el usuario (ver el trigger `profiles_admin_immutable`
  // de la migration 038), asi que ni el valor ni su RLS se pueden manipular
  // desde el navegador.
  //
  // Esta es la unica comprobacion que decide acceso. Que el sidebar esconda el
  // link y que la pagina redirija son comodidad, no seguridad.
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    logger.error('Admin analytics: no se pudo leer el perfil:', { error: error.message });
    // Fail closed: si no se puede determinar el flag, no se concede acceso.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!isAdminProfile(profile)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await getAdminAnalytics();

  // El service devuelve `ok: false` cuando las vistas de la migracion 040
  // todavia no existen. 503 y no 200 con datos vacios: el panel tiene que
  // poder distinguir "no hay eventos todavia" de "no puedo leer la tabla".
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return NextResponse.json(result.data);
}
