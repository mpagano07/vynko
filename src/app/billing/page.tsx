'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { PLANS } from '@/lib/plans';
import { CreditCard, CheckCircle2, Loader2, Zap, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';

export default function BillingPage() {
  const { role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (role && role === 'member') router.replace('/dashboard');
  }, [role, router]);

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

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = {};
        if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
        const res = await fetch('/api/billing/status', { headers });
        if (res.ok) setSubscription(await res.json());
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  const handleSubscribe = async (planId: string) => {
    setCheckoutLoading(planId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const res = await fetch('/api/billing/create-checkout', {
        method: 'POST', headers,
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Error'); return; }
      if (data.url) window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleCancelConfirm = async () => {
    setCancelling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const res = await fetch('/api/billing/portal', { method: 'POST', headers });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Error'); return; }
      toast.success('Suscripción cancelada');
      setSubscription(null);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCancelling(false);
      setShowCancelModal(false);
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

  const currentPlanId = subscription?.plan || 'starter';

  const TRIAL_DAYS = 30;
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

  const isTrial = subscription?.status === 'free' || subscription?.status === 'inactive';

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Trial / Renewal banner - only shown for trials or when renewal is within 7 days */}
      {subscription && (isTrial || (daysUntilRenewal !== null && daysUntilRenewal <= 7)) && (
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
                    ? 'Suscribite a un plan para seguir usando StockPilot'
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
                    : `El ${new Date(subscription.currentPeriodEnd!).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })} se renovará tu suscripción`}
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
                    Próximo ciclo: {new Date(subscription.currentPeriodEnd).toLocaleDateString('es-AR')}
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
        </Card>
      )}

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(PLANS).map(([id, plan]) => {
          const isCurrent = id === currentPlanId;
          const isPopular = id === 'starter';

          return (
            <Card key={id} className={`p-6 relative flex flex-col ${isCurrent ? 'ring-2 ring-indigo-500' : ''} ${isPopular && !isCurrent ? 'border-indigo-200 dark:border-indigo-800' : ''}`}>
              {id === 'starter' && !isCurrent && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-semibold bg-indigo-600 text-white px-3 py-0.5 rounded-full">
                  30 días gratis
                </span>
              )}
              {isCurrent && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-semibold bg-emerald-600 text-white px-3 py-0.5 rounded-full">
                  Plan actual
                </span>
              )}

              <h3 className="text-lg font-bold text-gray-900 dark:text-white mt-1">{plan.name}</h3>
              <div className="mt-2 mb-4">
                {plan.price > 0 ? (
                  <>
                    <span className="text-3xl font-extrabold text-gray-900 dark:text-white">${plan.price.toLocaleString('es-AR')}</span>
                    <span className="text-sm text-gray-500">/mes</span>
                  </>
                ) : (
                  <span className="text-xl font-semibold text-gray-500">{id === 'enterprise' ? 'A medida' : ''}</span>
                )}
              </div>

              <ul className="space-y-2 flex-1 mb-6">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              {!isCurrent && (
                <Button
                  onClick={() => handleSubscribe(id)}
                  disabled={checkoutLoading === id}
                  variant={isPopular ? 'primary' : 'outline'}
                  className="w-full"
                >
                  {checkoutLoading === id ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Procesando...</>
                  ) : (
                    <>Suscribirse <ArrowRight className="h-4 w-4 ml-1" /></>
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
          <p className="text-xs text-gray-500 mt-0.5">Contactanos para consultas sobre facturación o para planes enterprise.</p>
        </div>
        <Button variant="outline" onClick={() => window.open('mailto:support@stockpilot.app', '_blank')}>
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
        onConfirm={handleCancelConfirm}
        onCancel={() => setShowCancelModal(false)}
      />
    </div>
  );
}
