import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { MANAGE_ROLES, type TenantRole } from '@/lib/roles';

// Roles que pueden operar operaciones sensibles (no solo ver). Se reexporta
// desde `roles.ts` para que el cliente pueda usar las mismas etiquetas sin
// arrastrar el cliente de Supabase al bundle.
export { MANAGE_ROLES } from '@/lib/roles';

export async function getRoleInTenant(userId: string, tenantId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('tenant_users')
    .select('role')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return (data?.role as string | null) ?? null;
}

export function canManageTenant(role: string | null): boolean {
  return role !== null && (MANAGE_ROLES as readonly string[]).includes(role as TenantRole);
}
