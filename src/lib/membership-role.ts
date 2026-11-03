import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { hasCapability, type Capability, type TenantRole } from '@/lib/roles';

// Se reexporta desde `roles.ts` para que el cliente pueda usar las mismas
// etiquetas sin arrastrar el cliente de Supabase al bundle.
export { MANAGE_ROLES } from '@/lib/roles';
export { hasCapability } from '@/lib/roles';

export async function getRoleInTenant(userId: string, tenantId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('tenant_users')
    .select('role')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return (data?.role as string | null) ?? null;
}

/**
 * ¿El rol tiene la capacidad pedida? Se mantiene `canManageTenant` como alias
 * de `manage_tenant` para no tocar los llamadores históricos.
 */
export function canManageTenant(role: string | null): boolean {
  return hasCapability(role as TenantRole | null, 'manage_tenant');
}

/** ¿El rol de esta persona en esta sucursal tiene la capacidad pedida? */
export async function canInTenant(
  userId: string,
  tenantId: string,
  capability: Capability
): Promise<boolean> {
  return hasCapability(await getRoleInTenant(userId, tenantId), capability);
}
