import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { PLANS, getEffectivePrice, getTrialDays, getTrialPlan, getRemainingTrialDays, PLAN_ORDER, NEW_ACCOUNT_PLAN } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';
import { createPreApproval, cancelPreApproval } from '@/lib/mercadopago';
import { createPaddleCheckout, getPaddlePriceId, cancelPaddleSubscription } from '@/lib/paddle';
import { getPaddleConfiguredCurrencies } from '@/lib/paddle-price-ids';
import {
  asBillingProvider,
  isPaddlePlan,
  resolveBillingProvider,
} from '@/lib/billing-provider';
import { getCountryFromHeaders, getCurrencyForCountry } from '@/lib/pricing';
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
    .select('name, billing_email, billing_provider, paddle_customer_id')
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

  // Todas las ramas del owner comparten la suscripción: el estado (proveedor,
  // ids de pago) se escribe en todas para que el gate y el estado consolidado
  // los vean sin importar desde qué sucursal se mire.
  const ownerBranchIds = await resolveOwnerBranchIds(tenantId, [tenantId]);

  // La prueba gratuita es por owner y arranca en su primera rama. Para no
  // regalar un trial nuevo en cada suscripción, el preapproval de Mercado Pago
  // solo lleva los días de prueba que le quedan a la cuenta (0 si ya venció).
  let trialPeriodDays = 0;
  if (planConfig.id === getTrialPlan()) {
    const { data: branchRows } = await supabaseAdmin
      .from('tenants')
      .select('created_at')
      .in('id', ownerBranchIds);
    const earliestCreatedAt = (branchRows ?? []).reduce<string | null>((earliest, row) => {
      const createdAt = (row as { created_at?: string | null }).created_at ?? null;
      if (!createdAt) return earliest;
      return !earliest || new Date(createdAt) < new Date(earliest) ? createdAt : earliest;
    }, null);
    trialPeriodDays = getRemainingTrialDays(earliestCreatedAt);
  }

  const backUrl = safeInternalRedirect(request, '/billing?success=true');

  // País del visitante → moneda → pasarela. Argentina (y cualquier país sin
  // precio de Paddle configurado) sigue con MercadoPago en ARS; el resto cobra
  // por Paddle en su moneda local. Si la cuenta ya paga con una pasarela, se
  // respeta esa para no partir la suscripción entre dos cobradores.
  const country = getCountryFromHeaders(request.headers);
  const currency = getCurrencyForCountry(country, new Set(getPaddleConfiguredCurrencies()));
  const existingProvider = asBillingProvider(tenant?.billing_provider);
  const provider = resolveBillingProvider(country, planConfig.id, existingProvider);

  if (provider === 'paddle') {
    if (!isPaddlePlan(planConfig.id)) {
      return { ok: false, error: 'Plan inválido o no disponible', status: 400 };
    }
    const priceId = getPaddlePriceId(currency, planConfig.id);
    if (!priceId) {
      return { ok: false, error: 'El pago con tarjeta todavía no está disponible para tu país.', status: 400 };
    }
    try {
      const checkout = await createPaddleCheckout({
        priceId,
        tenantId,
        plan: planConfig.id,
        customerId: tenant?.paddle_customer_id ?? null,
        checkoutUrl: process.env.PADDLE_CHECKOUT_URL || null,
      });

      await supabaseAdmin
        .from('tenants')
        .update({
          billing_provider: 'paddle',
          paddle_pending_transaction_id: checkout.transactionId,
          // Queda registrado el `pri_` concreto del checkout (cada moneda tiene
          // el suyo y no se deduce del plan sin la config de env) para soporte
          // y auditoría.
          paddle_price_id: priceId,
        })
        .in('id', ownerBranchIds);

      return { ok: true, data: { url: checkout.url } };
    } catch (err) {
      logger.error('Error creating Paddle transaction:', { error: err });
      return { ok: false, error: 'No se pudo iniciar el pago. Intentá de nuevo en unos minutos.', status: 502 };
    }
  }

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
        trial_period_days: trialPeriodDays,
      },
    });

    await supabaseAdmin
      .from('tenants')
      .update({
        mercadopago_preapproval_id: preapproval.id,
        billing_provider: 'mercadopago',
      })
      .in('id', ownerBranchIds);

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
    .select('id, name, billing_email, billing_provider, paddle_customer_id, subscription_plan, subscription_status, mercadopago_preapproval_id, created_at')
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

  // Un cambio de plan se cobra con la misma pasarela que ya tiene la cuenta:
  // no se puede cancelar en Paddle algo que se paga por MercadoPago. Si nunca
  // pagó, se asume MercadoPago (comportamiento histórico).
  const provider = asBillingProvider(mainTenant.billing_provider) ?? 'mercadopago';

  if (provider === 'paddle') {
    if (!isPaddlePlan(plan)) {
      return { ok: false, error: 'Plan inválido', status: 400 };
    }
    const currency = getCurrencyForCountry(
      getCountryFromHeaders(request.headers),
      new Set(getPaddleConfiguredCurrencies())
    );
    const priceId = getPaddlePriceId(currency, plan);
    if (!priceId) {
      return { ok: false, error: 'El pago con tarjeta todavía no está disponible para tu país.', status: 400 };
    }
    try {
      const checkout = await createPaddleCheckout({
        priceId,
        tenantId: mainTenant.id,
        plan,
        customerId: mainTenant.paddle_customer_id ?? null,
        checkoutUrl: process.env.PADDLE_CHECKOUT_URL || null,
      });

      await supabaseAdmin
        .from('tenants')
        .update({
          paddle_pending_transaction_id: checkout.transactionId,
          paddle_pending_plan: plan,
          // Ver la nota en `createCheckoutSession`: se guarda el `pri_` del
          // checkout iniciado (el del plan destino).
          paddle_price_id: priceId,
        })
        .in('id', ownerBranchIds);

      url = checkout.url;
    } catch (err) {
      logger.error('Error creating Paddle transaction on downgrade:', { error: err });
      return { ok: false, error: 'No se pudo iniciar el pago. Intentá de nuevo en unos minutos.', status: 502 };
    }

    return { ok: true, data: { success: true, plan, url } };
  }

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
    .select('mercadopago_preapproval_id, paddle_subscription_id, billing_provider, subscription_current_period_end, subscription_plan')
    .eq('id', ownerTenant.tenant_id)
    .single();

  const provider = asBillingProvider(tenant?.billing_provider) ?? 'mercadopago';

  // La suscripcion es del OWNER, no de la rama: cancelar desde el portal tiene
  // que tocar todas las ramas igual que hace el webhook. Antes solo se
  // actualizaba `ownerTenant.tenant_id`, y como el webhook si propaga a todas,
  // el resultado dependedia de si la cancelacion venia del portal o de la
  // notificacion: misma accion de negocio, dos finales distintos.
  const ownerBranchIds = await resolveOwnerBranchIds(ownerTenant.tenant_id, [ownerTenant.tenant_id]);

  if (provider === 'paddle') {
    if (!tenant?.paddle_subscription_id) {
      return { ok: false, error: 'Sin suscripción activa', status: 400 };
    }

    // `next_billing_period`: el usuario mantiene el acceso hasta que vence el
    // período que ya pagó; Paddle deja de cobrar a partir del siguiente.
    await cancelPaddleSubscription(tenant.paddle_subscription_id, false);

    await supabaseAdmin
      .from('tenants')
      .update({
        subscription_status: 'canceled',
        subscription_plan: 'free',
        paddle_subscription_id: null,
        paddle_pending_transaction_id: null,
        paddle_pending_plan: null,
        subscription_current_period_end: tenant.subscription_current_period_end ?? null,
      })
      .in('id', ownerBranchIds);

    await trackEvent({
      type: 'subscription_cancelled',
      userId,
      tenantId: ownerTenant.tenant_id,
      metadata: {
        plan: tenant.subscription_plan ?? 'unknown',
        subscription_id: tenant.paddle_subscription_id,
        provider: 'paddle',
        source: 'portal',
      },
    });

    return { ok: true, data: { success: true } };
  }

  if (!tenant?.mercadopago_preapproval_id) {
    return { ok: false, error: 'Sin suscripción activa', status: 400 };
  }

  await cancelPreApproval(tenant.mercadopago_preapproval_id);

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
    .select('subscription_status, subscription_plan, subscription_current_period_end, created_at, mercadopago_pending_plan, mercadopago_preapproval_id, mercadopago_pending_preapproval_id, billing_provider, paddle_pending_transaction_id')
    .in('id', tenantIds);

  // Every branch of the owner shares a single subscription.
  const tenant = consolidateOwnerSubscription(tenants as TenantSubscription[] | null);

  // Checkout iniciado y no confirmado: hay un pago guardado (preapproval de MP
  // o transacción de Paddle) pero la cuenta todavía no está activa (y no es un
  // cambio de plan, que se gestiona aparte). Se usa para avisarle al usuario
  // que completó el pago y, mientras tanto, sigue en la prueba.
  const hasPendingCheckout = (tenants ?? []).some((row) => {
    const t = row as {
      subscription_status?: string | null;
      mercadopago_preapproval_id?: string | null;
      mercadopago_pending_preapproval_id?: string | null;
      paddle_pending_transaction_id?: string | null;
    };
    const status = t.subscription_status || 'free';
    if (status !== 'free' && status !== 'inactive') return false;
    const mpPending = Boolean(t.mercadopago_preapproval_id) && !t.mercadopago_pending_preapproval_id;
    const paddlePending = Boolean(t.paddle_pending_transaction_id);
    return mpPending || paddlePending;
  });

  // Pasarela con la que se cobra la cuenta, para que la UI muestre el nombre
  // correcto (Mercado Pago / Paddle) en los avisos de pago pendiente.
  const provider = (tenants ?? [])
    .map((row) => (row as { billing_provider?: string | null }).billing_provider)
    .find((p) => p === 'mercadopago' || p === 'paddle') ?? null;

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
        .select('mercadopago_pending_plan, paddle_pending_plan')
        .eq('id', tu2[0].tenant_id)
        .maybeSingle()
    : null;

  const pendingRow = pendingTenant?.data as
    | { mercadopago_pending_plan?: PlanId | null; paddle_pending_plan?: PlanId | null }
    | null;
  const pendingPlan = pendingRow?.mercadopago_pending_plan ?? pendingRow?.paddle_pending_plan ?? null;

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
      pendingCheckout: hasPendingCheckout,
      provider,
    },
  };
}
