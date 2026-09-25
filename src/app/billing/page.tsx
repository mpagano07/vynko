'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IconAction } from '@/components/ui/icon-action';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { SupportModal } from '@/components/ui/support-modal';
import { SalesContactModal } from '@/components/ui/sales-contact-modal';
import {
  PLANS,
  PLAN_ORDER,
  NEW_ACCOUNT_PLAN,
  getTrialDays,
  getTrialPlan,
  getPlanBadge,
  getActivePromoPlan,
  getEffectivePrice,
} from '@/lib/plans';
import type { PlanId } from '@/lib/plans';
import { formatARS } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/format';
import { CreditCard, CheckCircle2, XCircle, Loader2, ArrowRight, AlertTriangle, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/hooks/useAuth';
import { authFetch } from '@/lib/fetchWithTenant';
import { useRouter, useSearchParams } from 'next/navigation';

export default function BillingPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </div>
    }>
      <BillingContent />
    </Suspense>
  );
}

function BillingContent() {
  const { role, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const blockedReason = searchParams?.get('blocked');

  const [subscription, setSubscription] = useState<{
    plan: string;
    planName: string;
    status: string;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    createdAt: string | null;
    features: string[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showRevocationModal, setShowRevocationModal] = useState(false);
  const [showRevocationTooltip, setShowRevocationTooltip] = useState(false);
  const revocationTooltipRef = useRef<HTMLDivElement>(null);
  const [revocationDone, setRevocationDone] = useState(false);
  const [pendingDowngrade, setPendingDowngrade] = useState<string | null>(null);
  const [downgrading, setDowngrading] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showSalesModal, setShowSalesModal] = useState(false);

  useEffect(() => {
    if (!authLoading && role === 'member') router.replace('/dashboard');
  }, [authLoading, role, router]);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/billing/status');
        if (res.ok) {
          setSubscription(await res.json());
        } else {
          toast.error('No se pudo verificar el estado de tu suscripción');
        }
      } catch {
        toast.error('No se pudo verificar el estado de tu suscripción');
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!showRevocationTooltip) return;
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (revocationTooltipRef.current && !revocationTooltipRef.current.contains(event.target as Node)) {
        setShowRevocationTooltip(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showRevocationTooltip]);

  if (authLoading || role === 'member') return null;

  const handleSubscribe = async (planId: string) => {
    const targetRank = PLAN_ORDER.indexOf(planId as PlanId);
    const currentRank = PLAN_ORDER.indexOf((currentPlanId as PlanId) || NEW_ACCOUNT_PLAN);

    if (planId === 'enterprise') {
      setShowSalesModal(true);
      return;
    }

    if (targetRank < currentRank) {
      setPendingDowngrade(planId);
      return;
    }

    setCheckoutLoading(planId);
    try {
      const res = await authFetch('/api/billing/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Error'); return; }
      if (data.url) window.location.assign(data.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleDowngradeConfirm = async () => {
    if (!pendingDowngrade) return;
    setDowngrading(true);
    try {
      const res = await authFetch('/api/billing/downgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: pendingDowngrade }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Error'); return; }

      setPendingDowngrade(null);

      if (data.url) {
        toast.success(`Tu plan es ${PLANS[pendingDowngrade as PlanId].name}. Completá el pago para activar tu suscripción.`);
        window.location.assign(data.url);
        return;
      }

      toast.success(`Cambiaste al plan ${PLANS[pendingDowngrade as PlanId].name}`);
      const statusRes = await authFetch('/api/billing/status');
      if (statusRes.ok) setSubscription(await statusRes.json());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setDowngrading(false);
    }
  };

  const cancelSubscription = async (revoke = false) => {
    setCancelling(true);
    try {
      const res = await authFetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Error'); return; }
      toast.success('Suscripción cancelada');
      setSubscription(null);
      if (revoke) setRevocationDone(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setCancelling(false);
      setShowCancelModal(false);
      setShowRevocationModal(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500 mb-3" />
        <p className="text-sm text-gray-500">Cargando información de facturación...</p>
      </div>
    );
  }

  const currentPlanId = subscription?.plan || NEW_ACCOUNT_PLAN;
  const isPlanActive = subscription?.status === 'active';

  const TRIAL_DAYS = getTrialDays();
  const TRIAL_PLAN = getTrialPlan();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysUntilRenewal = subscription?.currentPeriodEnd
    ? Math.max(0, Math.floor((new Date(subscription.currentPeriodEnd).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : null;
  const daysUntilTrialEnd = subscription?.createdAt
    ? (() => {
        const created = new Date(subscription.createdAt!);
        const createdDay = new Date(created.getFullYear(), created.getMonth(), created.getDate());
        const daysElapsed = Math.floor((todayStart.getTime() - createdDay.getTime()) / (1000 * 60 * 60 * 24));
        return Math.max(-1, TRIAL_DAYS - daysElapsed);
      })()
    : null;

  const isTrial = !!TRIAL_PLAN && subscription?.plan === TRIAL_PLAN && (subscription?.status === 'free' || subscription?.status === 'inactive');

  const autoBlockedReason = blockedReason
    ? blockedReason
    : subscription?.status === 'past_due'
    ? 'payment_past_due'
    : isTrial && daysUntilTrialEnd !== null && daysUntilTrialEnd < 0
    ? 'trial_expired'
    : null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {autoBlockedReason && (
        <div className="rounded-xl p-5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 flex items-start gap-4">
          <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/50 flex-shrink-0">
            <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
          <div className="flex-1">
            <p className="text-base font-bold text-red-800 dark:text-red-300">
              {autoBlockedReason === 'trial_expired'
                ? 'Tu período de prueba finalizó'
                : 'Suscripción vencida'}
            </p>
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
              {autoBlockedReason === 'trial_expired'
                ? `Los ${TRIAL_DAYS} días de prueba gratuita terminaron. Seleccioná uno de los planes para seguir usando todas las funcionalidades de Vynko.`
                : 'No se pudo procesar el pago de tu suscripción. Seleccioná un plan o actualizá tu método de pago para recuperar el acceso.'}
            </p>
          </div>
        </div>
      )}

      {/* Trial / Renewal banner - only shown when not already blocked */}
      {subscription && !autoBlockedReason && (isTrial || (daysUntilRenewal !== null && daysUntilRenewal <= 7)) && (
        <div className={`rounded-xl p-4 flex items-start gap-3 ${
          isTrial && daysUntilTrialEnd !== null && daysUntilTrialEnd <= 7
            ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900'
            : isTrial && daysUntilTrialEnd !== null && daysUntilTrialEnd < 0
            ? 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900'
            : 'bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900'
        }`}>
          <div className={`p-2 rounded-lg ${
            isTrial && daysUntilTrialEnd !== null && daysUntilTrialEnd <= 7
              ? 'bg-amber-100 dark:bg-amber-900/50'
              : isTrial && daysUntilTrialEnd !== null && daysUntilTrialEnd < 0
              ? 'bg-red-100 dark:bg-red-900/50'
              : 'bg-indigo-100 dark:bg-indigo-900/50'
          }`}>
            <CreditCard className={`h-5 w-5 ${
              isTrial && daysUntilTrialEnd !== null && daysUntilTrialEnd <= 7
                ? 'text-amber-600 dark:text-amber-400'
                : isTrial && daysUntilTrialEnd !== null && daysUntilTrialEnd < 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-indigo-600 dark:text-indigo-400'
            }`} />
          </div>
          <div className="flex-1">
            {isTrial ? (
              <>
                <p className={`text-sm font-semibold ${
                  daysUntilTrialEnd !== null && daysUntilTrialEnd <= 7
                    ? 'text-amber-800 dark:text-amber-300'
                    : daysUntilTrialEnd !== null && daysUntilTrialEnd < 0
                    ? 'text-red-800 dark:text-red-300'
                    : 'text-indigo-800 dark:text-indigo-300'
                }`}>
                  {daysUntilTrialEnd !== null && daysUntilTrialEnd < 0
                    ? 'Tu período de prueba ha finalizado'
                    : daysUntilTrialEnd !== null && daysUntilTrialEnd <= 7
                    ? `Tu período de prueba termina en ${daysUntilTrialEnd} día${daysUntilTrialEnd === 1 ? '' : 's'}`
                    : `Te quedan ${daysUntilTrialEnd} días de prueba gratuita`}
                </p>
                <p className={`text-xs mt-0.5 ${
                  daysUntilTrialEnd !== null && daysUntilTrialEnd <= 7
                    ? 'text-amber-600 dark:text-amber-400'
                    : daysUntilTrialEnd !== null && daysUntilTrialEnd < 0
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-indigo-600 dark:text-indigo-400'
                }`}>
                  {daysUntilTrialEnd !== null && daysUntilTrialEnd < 0
                    ? 'Suscribite a un plan para seguir usando Vynko'
                    : 'Elegí un plan para no perder acceso a las funcionalidades'}
                </p>
              </>
            ) : daysUntilRenewal !== null && daysUntilRenewal <= 7 ? (
              <>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  Próximo cobro en {daysUntilRenewal} día{daysUntilRenewal === 1 ? '' : 's'}
                </p>
                <p className="text-xs mt-0.5 text-amber-600 dark:text-amber-400">
                  {daysUntilRenewal === 0
                    ? 'El cobro se procesará hoy'
                    : `El ${formatDate(subscription.currentPeriodEnd!, { weekday: 'long', day: 'numeric', month: 'long' })} se renovará tu suscripción`}
                </p>
              </>
            ) : null}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600">
          <CreditCard className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Planes disponibles</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Gestioná tu suscripción y métodos de pago</p>
        </div>
      </div>

      {/* Current Plan */}
      {subscription && (
        <Card className="p-6 border-l-4 border-l-indigo-500">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Plan actual</p>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{subscription.planName}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  subscription.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                  subscription.status === 'past_due' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                }`}>
                  {subscription.status === 'active' ? 'Activo' :
                   subscription.status === 'past_due' ? 'Vencido' :
                   subscription.status === 'inactive' ? 'Sin plan' : subscription.status}
                </span>
                {subscription.currentPeriodEnd && (
                  <span className="text-xs text-gray-500">
                    Próximo ciclo: {formatDate(subscription.currentPeriodEnd, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </span>
                )}
              </div>
            </div>
            {subscription.status === 'active' && (
              <Button variant="outline" onClick={() => setShowCancelModal(true)} className="flex items-center gap-2 text-red-600 border-red-200 hover:bg-red-50">
                Cancelar suscripción
              </Button>
            )}
          </div>
          {subscription.status === 'active' && (
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setShowRevocationModal(true)}
                  className="text-indigo-600 border-indigo-200 hover:bg-indigo-50 dark:border-indigo-800 dark:hover:bg-indigo-950/30"
                >
                  Botón de arrepentimiento
                </Button>
                <div className="relative" ref={revocationTooltipRef}>
                  <IconAction
                    icon={Info}
                    label="Detalle del derecho de arrepentimiento"
                    tone="muted"
                    className="rounded-full hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-transparent dark:hover:bg-transparent"
                    onClick={() => setShowRevocationTooltip((v) => !v)}
                  />
                  {showRevocationTooltip && (
                    <div className="absolute left-0 top-full mt-1.5 z-30 w-72 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3.5 shadow-2xl shadow-black/15 dark:shadow-black/60">
                      <p className="text-xs font-bold text-gray-900 dark:text-white">
                        Botón de arrepentimiento
                      </p>
                      <p className="mt-1.5 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                        Podés revocar la contratación desde el mismo medio electrónico por el que lo realizaste, sin trámites adicionales y dentro de los diez (10) días corridos.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {revocationDone && (
        <Card className="p-6 border-l-4 border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex-shrink-0">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1 text-sm text-gray-700 dark:text-gray-300">
              <p className="font-bold text-gray-900 dark:text-white">Baja registrada por derecho de arrepentimiento</p>
              <p className="mt-1">
                Tu suscripción fue cancelada. Si tu pago se procesó dentro de los últimos 10 días, tenés derecho a que se reintegre el importe abonado (art. 34, Ley N° 24.240). Para solicitar el reembolso enviá un correo a{' '}
                <a href={`mailto:soporte@vynko.dev?subject=${encodeURIComponent('Reembolso - Derecho de arrepentimiento (Ley N° 24.240, art. 34)')}`} className="text-emerald-700 dark:text-emerald-300 font-medium underline underline-offset-4">
                  soporte@vynko.dev
                </a>{' '}
                indicando tu número de cuenta; procesaremos la restitución dentro de los plazos legales.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(PLANS).map(([id, plan]) => {
          const isCurrent = id === currentPlanId;
          const isPopular = id === getActivePromoPlan();
          const badge = getPlanBadge(id);
          const isDowngrade = PLAN_ORDER.indexOf(id as PlanId) < PLAN_ORDER.indexOf((currentPlanId as PlanId) || NEW_ACCOUNT_PLAN);

          return (
            <Card key={id} className={`p-6 relative flex flex-col ${isCurrent ? 'ring-2 ring-indigo-500' : ''} ${isPopular && !isCurrent ? 'border-indigo-200 dark:border-indigo-800' : ''}`}>
              {badge && !isCurrent && (
                <span className={`absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-semibold px-3 py-0.5 rounded-full ${plan.comingSoon ? 'bg-gray-500 text-white' : 'bg-indigo-600 text-white'}`}>
                  {badge}
                </span>
              )}
              {isCurrent && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-semibold bg-emerald-600 text-white px-3 py-0.5 rounded-full">
                  Plan actual
                </span>
              )}

              <h3 className="text-lg font-bold text-gray-900 dark:text-white mt-1">{plan.name}</h3>
              <div className="mt-2 mb-4">
                {plan.comingSoon ? (
                  <span className="text-xl font-semibold text-gray-500">Próximamente</span>
                ) : getEffectivePrice(id) > 0 ? (
                  <>
                    <span className="text-3xl font-extrabold text-gray-900 dark:text-white">{formatARS(getEffectivePrice(id))}</span>
                    <span className="text-sm text-gray-500">/mes</span>
                  </>
                ) : (
                  <span className="text-xl font-semibold text-gray-500">{id === 'enterprise' ? 'A medida' : ''}</span>
                )}
              </div>

              <ul className="space-y-2 flex-1 mb-6">
                {plan.features.map((f) => (
                  <li key={f.label} className={`flex items-start gap-2 text-sm ${f.included ? 'text-gray-600 dark:text-gray-400' : 'text-gray-400 dark:text-gray-600'}`}>
                    {f.included ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-400 dark:text-gray-600 flex-shrink-0 mt-0.5" />
                    )}
                    <span>
                      {f.label}
                      {f.value && <span className="font-semibold text-gray-800 dark:text-gray-200"> {f.value}</span>}
                    </span>
                  </li>
                ))}
              </ul>

              {id === 'enterprise' ? (
                <Button
                  onClick={() => handleSubscribe('enterprise')}
                  className="w-full bg-amber-500 text-black hover:bg-amber-400"
                >
                  Pensado a tu medida <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (!isCurrent || !isPlanActive) && (
                <Button
                  onClick={() => handleSubscribe(id)}
                  disabled={checkoutLoading === id}
                  variant={isPopular ? 'primary' : 'outline'}
                  className="w-full"
                >
                  {checkoutLoading === id ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Procesando...</>
                  ) : (
                    <>{isDowngrade && !isCurrent ? `Cambiar a ${plan.name}` : 'Suscribirse'} <ArrowRight className="h-4 w-4 ml-1" /></>
                  )}
                </Button>
              )}

              {isCurrent && subscription?.status === 'active' && (
                <Button variant="outline" onClick={() => setShowCancelModal(true)} className="w-full text-red-600 border-red-200 hover:bg-red-50">
                  Cancelar suscripción
                </Button>
              )}
            </Card>
          );
        })}
      </div>

      {/* Environment notice */}
      {(!process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY ||
        process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY === 'YOUR_MERCADOPAGO_PUBLIC_KEY') && (
        <Card className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/30">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Mercado Pago no está configurado. Para activar pagos, configurá las credenciales en{' '}
            <code className="text-xs bg-amber-100 dark:bg-amber-900/50 px-1 rounded">.env.local</code>.
          </p>
        </Card>
      )}

      {/* Sidebar link */}
      <Card className="p-6 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">¿Necesitás ayuda?</h3>
          <p className="text-xs text-gray-500 mt-0.5">Contactanos para consultas sobre facturación o cotizaciones de planes enterprise.</p>
        </div>
        <Button variant="outline" onClick={() => setShowSupportModal(true)}>
          Contactar soporte
        </Button>
      </Card>

      <ConfirmModal
        open={showCancelModal}
        title="Cancelar suscripción"
        message="¿Estás seguro de cancelar la suscripción? Perderás acceso a las funciones premium."
        confirmLabel="Sí, cancelar"
        cancelLabel="Volver"
variant="danger"
          loading={cancelling}
          onConfirm={() => cancelSubscription(false)}
          onCancel={() => setShowCancelModal(false)}
        />

      <ConfirmModal
        open={showRevocationModal}
        title="Derecho de arrepentimiento"
        message="Como consumidor tenés derecho a revocar la contratación dentro de los diez (10) días corridos desde la contratación, por el mismo medio electrónico (art. 34, Ley N° 24.240). Vynko no cobra penalidad ni exige trámite adicional. Al confirmar, se cancelará tu suscripción y podrás solicitar el reembolso del importe abonado. ¿Querés continuar?"
        confirmLabel="Sí, revocar"
        cancelLabel="Volver"
variant="danger"
          loading={cancelling}
          onConfirm={() => cancelSubscription(true)}
          onCancel={() => setShowRevocationModal(false)}
        />

      <ConfirmModal
        open={!!pendingDowngrade}
        title="¿Cambiar a Starter?"
        message="Al pasar al plan Starter vas a perder los beneficios de Business: los productos por encima de los primeros 50 quedan desactivados (se recuperan si volvés a Business), se quita el acceso a las sucursales excepto la primera, se eliminan los colaboradores y se desactivan las funciones avanzadas (pronóstico, visión de góndolas, IA). Se cancelará tu suscripción actual y se iniciará el pago de $19.900/mes por el plan Starter. ¿Querés continuar?"
        confirmLabel="Sí, cambiar a Starter"
        cancelLabel="Volver"
        variant="danger"
        loading={downgrading}
        onConfirm={handleDowngradeConfirm}
        onCancel={() => setPendingDowngrade(null)}
      />

      <SupportModal
        open={showSupportModal}
        onClose={() => setShowSupportModal(false)}
      />

      <SalesContactModal
        open={showSalesModal}
        onClose={() => setShowSalesModal(false)}
      />
    </div>
  );
}
