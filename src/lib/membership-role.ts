import { supabaseAdmin } from '@/lib/supabaseAdmin';

// Roles que pueden operar operaciones sensibles (no solo ver).
export const MANAGE_ROLES = ['owner', 'manager'] as const;

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
  return role !== null && (MANAGE_ROLES as readonly string[]).includes(role);
}