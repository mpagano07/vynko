import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export interface AuthInfo {
  tenantId: string;
  userId: string;
  allTenants: boolean;
  tenantIds: string[];
}

export async function getAuth(request?: Request): Promise<AuthInfo | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', user.id);

  if (!tu || tu.length === 0) return null;

  const tenantIds = (tu ?? []).map((t) => t.tenant_id);
  let tenantId = tenantIds[0];
  let allTenants = false;

  const activeTenantId = request?.headers.get('x-active-tenant-id');
  if (activeTenantId === '__all__') {
    // El consolidado de sucursales queda restringido a owners.
    const isOwner = tu.some((t) => t.role === 'owner');
    allTenants = isOwner;
  } else if (activeTenantId && tenantIds.includes(activeTenantId)) {
    tenantId = activeTenantId;
  }

  return { tenantId, userId: user.id, allTenants, tenantIds };
}
