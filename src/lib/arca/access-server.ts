import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isAdminProfile } from '@/lib/admin';
import { FACTURACION_LAUNCHED, canUseFacturacion } from '@/lib/arca/access';

/**
 * Versión de servidor de `canUseFacturacion`. Resuelve el perfil con
 * service_role porque `is_admin` no es manipulable desde el navegador (ver el
 * trigger `profiles_admin_immutable`).
 *
 * Fail closed: si no se puede leer el perfil, se niega el acceso.
 */
export async function canUseFacturacionForUser(
  userId: string,
  tenantId?: string
): Promise<boolean> {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .maybeSingle();

  if (error) return false;
  if (isAdminProfile(profile)) return true;

  // Todavía no lanzada: fuera de la cuenta admin no se habilita (por ahora,
  // tampoco por plan).
  if (!FACTURACION_LAUNCHED || !tenantId) return false;

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('subscription_plan')
    .eq('id', tenantId)
    .maybeSingle();

  return canUseFacturacion(profile, tenant);
}
