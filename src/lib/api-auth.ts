import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isSameOriginRequest } from '@/lib/security/csrf';

export interface AuthInfo {
  tenantId: string;
  userId: string;
  allTenants: boolean;
  tenantIds: string[];
}

export async function getAuth(request?: Request): Promise<AuthInfo | null> {
  // Las mutaciones se rechazan si el navegador las envía desde otro origen
  // (CSRF). Las cookies de sesión son SameSite=Lax, así que el POST
  // cross-site ya viaja sin credenciales; esto es la segunda barrera.
  if (request && !isSameOriginRequest(request)) return null;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', user.id);

  if (!tu || tu.length === 0) return null;

  const allTenantIds = (tu ?? []).map((t) => t.tenant_id);
  let tenantIds = allTenantIds;
  let tenantId = tenantIds[0];
  let allTenants = false;

  const activeTenantId = request?.headers.get('x-active-tenant-id');
  if (activeTenantId === '__all__') {
    // El consolidado queda restringido a los tenants donde el usuario es owner
    // (no a todos sus tenants de pertenencia).
    const ownerTenants = (tu ?? []).filter((t) => t.role === 'owner').map((t) => t.tenant_id);
    if (ownerTenants.length > 0) {
      allTenants = true;
      tenantId = ownerTenants[0];
      tenantIds = ownerTenants;
    }
  } else if (activeTenantId && tenantIds.includes(activeTenantId)) {
    tenantId = activeTenantId;
  }

  return { tenantId, userId: user.id, allTenants, tenantIds };
}
