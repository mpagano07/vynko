import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';

type SessionPayload = Record<string, unknown>;

function anonPayload(): SessionPayload {
  // Las mismas claves que el payload autenticado, con `role` incluida. Antes el
  // payload anon la omitia, asi que un cliente que leyera `data.role` recibia
  // `undefined` sin sesion y `null` con sesion sin membresias: dos valores para
  // "no hay rol". Un `data.role ?? 'owner'` en el cliente fallaba en un caso y
  // no en el otro.
  return {
    user: null,
    profile: null,
    tenant: null,
    tenants: [],
    role: null,
    onboarding_pending: true,
  };
}

/**
 * Resuelve el usuario de la request por el Bearer token o, si no viene, por la
 * cookie de sesion.
 *
 * La rama por cookie es la que permite que la cookie sea HttpOnly: el navegador
 * deja de poder leer el access token, asi que no puede mandarlo como header, y
 * la sesion tiene queResolved por el lado del servidor.
 */
export async function getSessionData(request: Request): Promise<{ ok: true; data: SessionPayload }> {
  const authHeader = request.headers.get('authorization');
  let user: Awaited<ReturnType<typeof supabaseAdmin.auth.getUser>>['data']['user'] = null;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (!userError) user = userData.user;
  } else {
    try {
      const supabase = await createServerSupabaseClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (!userError) user = userData.user;
    } catch (error) {
      console.error('Error resolving session from cookie:', error);
    }
  }

  if (!user) {
    return { ok: true, data: anonPayload() };
  }

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