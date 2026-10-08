import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { PLANS, getEffectivePrice, getTrialDays, getTrialPlan, PLAN_ORDER, NEW_ACCOUNT_PLAN } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';
import { createPreApproval, cancelPreApproval } from '@/lib/mercadopago';
import { resolveOwnerBranchIds } from '@/lib/mercadopago-webhook-service';
import { consolidateOwnerSubscription, type TenantSubscription } from '@/lib/checkSubscription';
import { canManageTenant } from '@/lib/membership-role';
import { safeInternalRedirect } from '@/lib/security/redirects';
import { trackEvent } from '@/lib/track-event';
import { logger } from '@/lib/logger';

export type BillingResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number; needsSalesContact?: boolean };

const planRank = (plan?: string | null): number => {
  const idx = PLAN_ORDER.indexOf((plan as PlanId) || NEW_ACCOUNT_PLAN);
  return idx === -1 ? 0 : idx;
};

export async function createCheckoutSession(
  user: { id: string; email?: string | null },
  body: { plan?: string | null },
  request: Request
): Promise<BillingResult> {
  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', user.id);
  if (!tu || tu.length === 0) return { ok: false, error: 'No tenant', status: 401 };

  const activeTenantId = request.headers.get('x-active-tenant-id');
  const membership = activeTenantId ? tu.find((t) => t.tenant_id === activeTenantId) : undefined;
  const tenantId = membership ? membership.tenant_id : tu[0].tenant_id;

  // 'admin' no es un rol válido en `tenant_users.role` (CHECK: owner|manager|member),
  // así que la condición nunca era verdadera. La suscripción se gestiona con los
  // mismos roles que el resto de acciones administrativas: owner o manager.
  const canManage = tu.some((t) => t.tenant_id === tenantId && canManageTenant(t.role));
  if (!canManage) {
    return { ok: false, error: 'Solo el owner o un administrador pueden gestionar la suscripción', status: 403 };
  }

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name, billing_email')
    .eq('id', tenantId)
    .single();

  const plan = body.plan;
  const planConfig = PLANS[plan as keyof typeof PLANS];

  if (!planConfig || planConfig.comingSoon) {
    return { ok: false, error: 'Plan inválido o no disponible', status: 400 };
  }

  // Enterprise se activa manualmente por ventas (cotización a medida), no vía
  // Mercado Pago recurrente. Devolvemos una acción de contacto para que la UI
  // muestre el CTA de ventas en lugar de redirigir a un checkout.
  if (planConfig.id === 'enterprise') {
    return { ok: false, error: 'El plan Enterprise se activa por ventas', needsSalesContact: true, status: 400 };
  }

  const backUrl = safeInternalRedirect(request, '/billing?success=true');

  try {
    const preapproval = await createPreApproval({
      payer_email: tenant?.billing_email || user.email!,
      reason: `Suscripción ${planConfig.name} - Vynko`,
      back_url: backUrl,
      external_reference: `${tenantId}:${planConfig.id}`,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: getEffectivePrice(planConfig.id),
        currency_id: 'ARS',
        trial_period_days: planConfig.id === getTrialPlan() ? getTrialDays() : 0,
      },
    });

    await supabaseAdmin
      .from('tenants')
      .update({ mercadopago_preapproval_id: preapproval.id })
      .eq('id', tenantId);

    return { ok: true, data: { url: preapproval.init_point } };
  } catch (err) {
    logger.error('Error creating MercadoPago preapproval:', { error: err });
    return { ok: false, error: 'No se pudo iniciar el pago. Intentá de nuevo en unos minutos.', status: 502 };
  }
}

export async function downgradePlan(
  user: { id: string; email?: string | null },
  plan: PlanId,
  request: Request
): Promise<BillingResult> {
  if (!PLAN_ORDER.includes(plan)) {
    return { ok: false, error: 'Plan inválido', status: 400 };
  }

  const { data: userTenants } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', user.id);

  if (!userTenants || userTenants.length === 0) {
    return { ok: false, error: 'Sin tenant', status: 401 };
  }

  const tenantIds = userTenants.map((t) => t.tenant_id as string);

  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id, name, billing_email, subscription_plan, subscription_status, mercadopago_preapproval_id, created_at')
    .in('id', tenantIds);

  if (!tenants || tenants.length === 0) {
    return { ok: false, error: 'Sin tenant', status: 404 };
  }

  const mainTenantId = userTenants[0].tenant_id as string;
  const mainTenant = tenants.find((t) => t.id === mainTenantId) || tenants[0];
  // const extraTenantIds = tenants.filter((t) => t.id !== mainTenant.id).map((t) => t.id);

  // Se resuelve ANTES de borrar membresias: `extraTenantIds` solo contiene las
  // ramas donde ESTE usuario es miembro, asi que las ramas del owner donde no es
  // miembro (otra sucursal con su propia sesion) no aparecen en `userTenants` y
  // se perderian. Sin esto, un downgrade dejaba al owner con el plan viejo en
  // esas ramas mientras la principal bajaba de plan.
  const ownerBranchIds = await resolveOwnerBranchIds(mainTenant.id, [mainTenant.id]);

  if (planRank(mainTenant.subscription_plan) <= planRank(plan)) {
    return {
      ok: false,
      error: `Tu plan actual (${mainTenant.subscription_plan}) no permite cambiar a ${plan}.`,
      status: 400,
    };
  }

  const ownership = userTenants.find((t) => t.tenant_id === mainTenant.id && t.role === 'owner');
  if (!ownership) {
    return { ok: false, error: 'Solo el propietario puede cambiar de plan', status: 403 };
  }

  // NO cancelar preapproval vigente ni hacer cambios destructivos (colaboradores,
  // invitaciones, estado) hasta que el webhook confirme el pago del preapproval
  // del plan destino. Esto evita que el downgrade aplique antes de cobrar.

  const targetPlanConfig = PLANS[plan];
  let url: string | null = null;
  try {
    const backUrl = safeInternalRedirect(request, '/billing?success=true');
    const preapproval = await createPreApproval({
      payer_email: mainTenant.billing_email || user.email!,
      reason: `Suscripción ${targetPlanConfig.name} - Vynko`,
      back_url: backUrl,
      external_reference: `${mainTenant.id}:${plan}`,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: targetPlanConfig.price,
        currency_id: 'ARS',
        trial_period_days: 0,
      },
    });

    await supabaseAdmin
      .from('tenants')
      .update({
        mercadopago_pending_preapproval_id: preapproval.id,
        mercadopago_pending_plan: plan as 'starter' | 'business',
      })
      .in('id', ownerBranchIds);

    url = preapproval.init_point || null;
  } catch (err) {
    logger.error('Error creating preapproval on downgrade:', { error: err });
    return { ok: false, error: 'No se pudo iniciar el pago. Intentá de nuevo en unos minutos.', status: 502 };
  }

  return { ok: true, data: { success: true, plan, url } };
}

export async function cancelSubscription(userId: string): Promise<BillingResult> {
  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', userId);
  if (!tu || tu.length === 0) return { ok: false, error: 'No tenant', status: 401 };

  // Cancelar la suscripción afecta el cobro de todo el owner: sólo owner o
  // manager del tenant pueden hacerlo. Antes bastaba con ser miembro.
  const ownerTenant = tu.find((t) => canManageTenant(t.role));
  if (!ownerTenant) {
    return { ok: false, error: 'Solo el owner o un administrador pueden cancelar la suscripción', status: 403 };
  }

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('mercadopago_preapproval_id, subscription_current_period_end, subscription_plan')
    .eq('id', ownerTenant.tenant_id)
    .single();

  if (!tenant?.mercadopago_preapproval_id) {
    return { ok: false, error: 'Sin suscripción activa', status: 400 };
  }

  await cancelPreApproval(tenant.mercadopago_preapproval_id);

  // La suscripcion es del OWNER, no de la rama: cancelar desde el portal tiene
  // que tocar todas las ramas igual que hace el webhook. Antes solo se
  // actualizaba `ownerTenant.tenant_id`, y como el webhook si propaga a todas,
  // el resultado dependedia de si la cancelacion venia del portal o de la
  // notificacion: misma accion de negocio, dos finales distintos.
  const ownerBranchIds = await resolveOwnerBranchIds(ownerTenant.tenant_id, [ownerTenant.tenant_id]);

  await supabaseAdmin
    .from('tenants')
    .update({
      subscription_status: 'canceled',
      subscription_plan: 'free',
      mercadopago_preapproval_id: null,
      subscription_current_period_end: tenant.subscription_current_period_end ?? null,
    })
    .in('id', ownerBranchIds);

  // El webhook tambien emite subscription_cancelled cuando llega la
  // notificacion de MercadoPago. Este es el camino del portal, y son
  // los dos un mismo hecho, asi que el evento se graba en los dos: el
  // panel lo suma y la razon de baja no depende de si la notificacion
  // llego. Para el webhook, que no tiene user_id, la fuente se guarda en
  // metadata para poder distinguirlos despues.
  await trackEvent({
    type: 'subscription_cancelled',
    userId,
    tenantId: ownerTenant.tenant_id,
    metadata: {
      plan: tenant.subscription_plan ?? 'unknown',
      preapproval_id: tenant.mercadopago_preapproval_id,
      source: 'portal',
    },
  });

  return { ok: true, data: { success: true } };
}

export async function getSubscriptionStatus(userId: string): Promise<BillingResult> {
  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', userId);
  if (!tu || tu.length === 0) return { ok: false, error: 'Not authenticated', status: 401 };

  const tenantIds = tu.map((t) => t.tenant_id);
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('subscription_status, subscription_plan, subscription_current_period_end, created_at, mercadopago_pending_plan')
    .in('id', tenantIds);

  // Every branch of the owner shares a single subscription.
  const tenant = consolidateOwnerSubscription(tenants as TenantSubscription[] | null);

  const trialPlan = getTrialPlan() ?? NEW_ACCOUNT_PLAN;
  const plan = (tenant?.subscription_plan as keyof typeof PLANS) || NEW_ACCOUNT_PLAN;
  const planConfig = PLANS[plan] || PLANS[NEW_ACCOUNT_PLAN];

  const TRIAL_DAYS = getTrialDays();
  const trialEndsAt = trialPlan && plan === trialPlan && tenant?.created_at
    ? new Date(new Date(tenant.created_at).getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const { data: tu2 } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', userId);
  const pendingTenant = tu2 && tu2[0]
    ? await supabaseAdmin
        .from('tenants')
        .select('mercadopago_pending_plan')
        .eq('id', tu2[0].tenant_id)
        .maybeSingle()
    : null;

  const pendingPlan = (pendingTenant?.data as { mercadopago_pending_plan?: PlanId | null } | null)
    ?.mercadopago_pending_plan;

  return {
    ok: true,
    data: {
      plan: plan,
      planName: planConfig.name,
      status: tenant?.subscription_status || 'inactive',
      currentPeriodEnd: tenant?.subscription_current_period_end,
      trialEndsAt,
      createdAt: tenant?.created_at,
      features: planConfig.features,
      pendingPlanChange: pendingPlan ?? null,
    },
  };
}
