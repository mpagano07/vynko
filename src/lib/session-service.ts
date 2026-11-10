import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { pickDefaultTenantId } from '@/lib/tenant-selection';
import { scheduleAfterBackground } from '@/lib/after-background';

type SessionPayload = Record<string, unknown>;

// Columnas que el cliente realmente consume. `select('*')` devolvia, ademas,
// los ids internos de los procesadores de pago (`mercadopago_preapproval_id`,
// `paddle_customer_id`, `paddle_price_id`, etc.): datos de infraestructura de
// cobro que no tienen por que viajar al navegador.
const TENANT_SESSION_COLUMNS = [
  'id',
  'name',
  'slug',
  'description',
  'logo_url',
  'company_name',
  'subscription_plan',
  'subscription_status',
  'subscription_current_period_end',
  'created_at',
  'razon_social',
  'cuit',
  'punto_venta',
  'iva_condition',
  'ingresos_brutos',
  'inicio_actividades',
  'business_address',
  'business_city',
  'business_province',
  'business_zip',
  'business_phone',
  'business_email',
].join(', ');

const PROFILE_SESSION_COLUMNS = [
  'id',
  'email',
  'full_name',
  'avatar_url',
  'tenant_id',
  'is_admin',
  'onboarding_pending',
  'onboarding_checklist_dismissed_at',
].join(', ');

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
      logger.error('Error resolving session from cookie:', { error });
    }
  }

  if (!user) {
    return { ok: true, data: anonPayload() };
  }

  // Perfil y membresías son independientes: se piden en paralelo. Encadenados
  // sumaban un round trip entero a Supabase en el camino crítico del login, que
  // es justo el que más se nota cuando la red va lenta.
  //
  // Las membresías inactivas no cuentan para la sesión: la persona sigue
  // existiendo, pero no tiene ninguna sucursal activa a la que entrar.
  const [profileResult, tenantUsersResult] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select(PROFILE_SESSION_COLUMNS)
      .eq('id', user.id)
      .maybeSingle(),
    supabaseAdmin
      .from('tenant_users')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('joined_at', { ascending: true }),
  ]);
  const profile = profileResult.data as {
    onboarding_pending?: boolean | null;
    [key: string]: unknown;
  } | null;
  const tenantUsers = tenantUsersResult.data;

  const activeTenantId = request.headers.get('x-active-tenant-id');

  let tenants: Record<string, unknown>[] = [];
  let tenant = null;
  let role = null;

  if (tenantUsers && tenantUsers.length > 0) {
    const tenantIds = tenantUsers.map((tu) => tu.tenant_id);

    const { data: tenantsData } = await supabaseAdmin
      .from('tenants')
      .select(TENANT_SESSION_COLUMNS)
      .in('id', tenantIds);

    tenants = (tenantsData as Record<string, unknown>[] | null) || [];

    let targetId =
      pickDefaultTenantId(tenantUsers) ?? tenantUsers[0].tenant_id;
    // `__all__` es el modo consolidado: también arranca en la empresa propia
    // (ver `pickDefaultTenantId`), igual que `getAuth`, para que el rol que
    // muestra la UI coincida con el que aplica el backend.
    if (
      activeTenantId &&
      activeTenantId !== '__all__' &&
      tenantIds.includes(activeTenantId)
    ) {
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
  //
  // No se espera la escritura: la respuesta ya lleva `onboardingPending = false`
  // y hacer esperar al usuario por un UPDATE de mantenimiento es sumarle otro
  // round trip al login. Es el mismo criterio que el resto de la bitácora.
  if ((tenantUsers?.length ?? 0) > 0 && profile?.onboarding_pending === true) {
    scheduleAfterBackground(() =>
      supabaseAdmin.from('profiles').update({ onboarding_pending: false }).eq('id', user.id)
    );
    onboardingPending = false;
  }

  return { ok: true, data: { user, profile, tenant, role, tenants, onboarding_pending: onboardingPending } };
}
