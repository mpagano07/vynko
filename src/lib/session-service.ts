import { supabaseAdmin } from '@/lib/supabaseAdmin';

type SessionPayload = Record<string, unknown>;

function anonPayload(): SessionPayload {
  return { user: null, profile: null, tenant: null, tenants: [], onboarding_pending: true };
}

export async function getSessionData(request: Request): Promise<{ ok: true; data: SessionPayload }> {
  const authHeader = request.headers.get('authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: true, data: anonPayload() };
  }

  const token = authHeader.replace('Bearer ', '');

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

  if (userError || !userData?.user) {
    return { ok: true, data: anonPayload() };
  }

  const user = userData.user;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  const { data: tenantUsers } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', user.id);

  const activeTenantId = request.headers.get('x-active-tenant-id');

  let tenants: Record<string, unknown>[] = [];
  let tenant = null;
  let role = null;

  if (tenantUsers && tenantUsers.length > 0) {
    const tenantIds = tenantUsers.map((tu) => tu.tenant_id);

    const { data: tenantsData } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .in('id', tenantIds);

    tenants = tenantsData || [];

    let targetId = tenantUsers[0].tenant_id;
    if (activeTenantId === '__all__') {
      // keep targetId as first tenant; no role change needed
    } else if (activeTenantId && tenantIds.includes(activeTenantId)) {
      targetId = activeTenantId;
    }

    const activeTU = tenantUsers.find((tu) => tu.tenant_id === targetId);
    role = activeTU?.role || null;
    tenant = tenants.find((t) => t.id === targetId) || tenants[0] || null;
  }

  // Flag directo de onboarding: FALSE = completado (nunca mostrar
  // onboarding), TRUE o perfil inexistente = pendiente.
  let onboardingPending = profile?.onboarding_pending !== false;

  // Self-healing (espejo del proxy): si el usuario ya tiene empresa pero el
  // flag quedó en TRUE, lo alineamos para que el guard de onboarding sea
  // directo la próxima vez.
  if ((tenantUsers?.length ?? 0) > 0 && profile?.onboarding_pending === true) {
    await supabaseAdmin.from('profiles').update({ onboarding_pending: false }).eq('id', user.id);
    onboardingPending = false;
  }

  return { ok: true, data: { user, profile, tenant, role, tenants, onboarding_pending: onboardingPending } };
}