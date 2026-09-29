'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTheme } from '@/lib/hooks/useTheme';
import { authFetch } from '@/lib/fetchWithTenant';
import { formatDate } from '@/lib/utils/format';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

import { isAdminProfile } from '@/lib/admin';
import type { AdminAnalytics, EventBreakdown, FunnelStep } from '@/lib/analytics-service';

interface AnalyticsData extends AdminAnalytics {
  error?: string;
}

const EVENT_LABELS: Record<string, string> = {
  signup: 'Registro',
  company_created: 'Empresa creada',
  trial_started: 'Trial iniciado',
  product_created: 'Producto creado',
  excel_import: 'Importó Excel',
  first_sale: 'Primera venta',
  first_cash_open: 'Primera caja',
  first_purchase: 'Primera compra',
  forecast_opened: 'Abrió pronóstico',
  document_created: 'Documento creado',
  whatsapp_ticket: 'WhatsApp',
  app_return: 'Volvió',
  subscription_started: 'Suscripción',
  subscription_cancelled: 'Cancelación',
};

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const isDark = useTheme();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdminProfile(profile)) {
      router.replace('/dashboard');
      return;
    }

    async function fetchData() {
      try {
        const res = await authFetch('/api/admin/analytics');
        const json = await res.json();
        // Un 503 significa que falta aplicar la migracion 040. Se muestra
        // el cartel y no un panel vacio, para que quede claro que el
        // problema es la base y no que todavia no hay datos.
        if (!res.ok) {
          setError(json?.error ?? 'Error al cargar datos');
          return;
        }
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido');
      }
    }

    fetchData();
  }, [user, profile, authLoading, router]);

  if (authLoading || (!data && !error)) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-24 bg-gray-200 dark:bg-gray-700 rounded-lg" />
            ))}
          </div>
          <div className="h-72 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !data || !user || !isAdminProfile(profile)) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <Card className="p-8 text-center">
          {error && /migracion 040/.test(error) && (
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
          )}
          <p className="text-red-500 dark:text-red-400 text-lg font-medium">{error || 'Acceso denegado'}</p>
          <Link href="/dashboard" className="text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300 text-sm mt-2 inline-block">
            Volver al dashboard
          </Link>
        </Card>
      </div>
    );
  }

  const chartData = data.signupsByMonth.map((s, i) => ({
    month: s.month,
    Registros: s.count,
    'Primera venta': data.activatedByMonth[i]?.count ?? 0,
    Suscripciones: data.subscribedByMonth[i]?.count ?? 0,
  }));

  const chartGridStroke = isDark ? '#374151' : '#e5e7eb';
  const chartTickFill = isDark ? '#9CA3AF' : '#6b7280';
  const chartTooltipBg = isDark ? '#1F2937' : '#ffffff';
  const chartTooltipBorder = isDark ? '#374151' : '#e5e7eb';
  const chartTooltipLabel = isDark ? '#F3F4F6' : '#1f2937';

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics Admin</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Dónde se cae la gente entre el registro y el primer pago</p>
        </div>
      </div>

      <FunnelCard funnel={data.funnel} />
      <BreakdownCard breakdown={data.breakdown} />

      <Card className="p-5">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">Registros vs primeras ventas vs suscripciones por mes</h2>
        {chartData.some((d) => d.Registros > 0 || d['Primera venta'] > 0 || d.Suscripciones > 0) ? (
          <ResponsiveContainer width="100%" height={300} minWidth={200} minHeight={128}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
              <XAxis dataKey="month" tick={{ fill: chartTickFill, fontSize: 12 }} />
              <YAxis tick={{ fill: chartTickFill, fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: chartTooltipBg, border: `1px solid ${chartTooltipBorder}`, borderRadius: '8px' }}
                labelStyle={{ color: chartTooltipLabel }}
              />
              <Legend />
              <Bar dataKey="Registros" fill="#3B82F6" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="Primera venta" fill="#F97316" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="Suscripciones" fill="#22C55E" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-500 text-sm text-center py-12">Sin datos todavía</p>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">Eventos recientes</h2>
        {data.recentEvents.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">Sin eventos registrados</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">Fecha</th>
                  <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">Tipo</th>
                  <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">Email</th>
                  <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">Nombre</th>
                  <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">Detalles</th>
                </tr>
              </thead>
              <tbody>
                {data.recentEvents.map((event) => (
                  <tr key={event.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="py-2.5 px-3 text-gray-600 dark:text-gray-300">
                      {formatDate(event.created_at, { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-2.5 px-3">
                      <StatusBadge tone={event.event_type === 'subscription_cancelled' ? 'red' : 'blue'}>
                        {EVENT_LABELS[event.event_type] ?? event.event_type}
                      </StatusBadge>
                    </td>
                    <td className="py-2.5 px-3 text-gray-600 dark:text-gray-300">{event.user_email || '-'}</td>
                    <td className="py-2.5 px-3 text-gray-600 dark:text-gray-300">{event.user_name || '-'}</td>
                    <td className="py-2.5 px-3 text-gray-500 dark:text-gray-400 text-xs">
                      {event.metadata && Object.keys(event.metadata).length > 0
                        ? JSON.stringify(event.metadata)
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * El embudo de activación. Cada fila es una puerta: el número cuenta
 * personas que pasaron TODAS las anteriores, en orden. La barra es
 * relativa al primer paso para que se lea la forma del embudo, y la
 * columna "caen" es la que dice dónde está el problema real.
 */
function FunnelCard({ funnel }: { funnel: FunnelStep[] }) {
  const total = funnel[0]?.users ?? 0;
  const paying = funnel[funnel.length - 1]?.users ?? 0;

  if (total === 0) {
    return (
      <Card className="p-5">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Embudo de activación</h2>
        <p className="text-gray-500 text-sm text-center py-8">
          Todavía no hay registros. Los eventos se empiezan a grabar con el deploy de esta rama.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">Embudo de activación</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {paying} de {total} llegaron a pagar ({total > 0 ? Math.round((paying / total) * 100) : 0}%)
        </p>
      </div>

      <div className="space-y-1">
        {funnel.map((step, i) => {
          const width = step.ofTotal;
          return (
            <div key={step.step} className="flex items-center gap-3 py-1.5">
              <div className="w-40 shrink-0 text-sm text-gray-600 dark:text-gray-300 truncate">
                {step.label}
              </div>
              <div className="flex-1 h-8 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
                <div
                  className="h-full bg-cyan-500 rounded transition-all"
                  style={{ width: `${Math.max(width, step.users > 0 ? 2 : 0)}%` }}
                />
              </div>
              <div className="w-12 shrink-0 text-right text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                {step.users}
              </div>
              <div className="w-14 shrink-0 text-right text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                {step.ofTotal}%
              </div>
              <div className="w-28 shrink-0 text-right text-xs tabular-nums">
                {i === 0 || step.dropped === 0 ? (
                  <span className="text-gray-400 dark:text-gray-600">—</span>
                ) : (
                  <span className="text-red-500 dark:text-red-400">
                    −{step.dropped} (−{100 - step.ofPrevious}%)
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
        Cada paso cuenta personas que pasaron todos los anteriores, en orden. La última
        columna es dónde se cae la gente respecto del paso previo.
      </p>
    </Card>
  );
}

/**
 * Eventos que NO forman parte del embudo porque son acciones optativas: no
 * todos los que venden abren caja ni comparten por WhatsApp. Encadenarlos
 * daría una progresión falsa, así que van sueltos, con la cantidad de
 * personas distintas y el total de ocurrencias (que difieren cuando el
 * evento se repite, como app_return).
 */
function BreakdownCard({ breakdown }: { breakdown: EventBreakdown[] }) {
  if (breakdown.length === 0) return null;

  return (
    <Card className="p-5">
      <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
        Eventos sueltos (no forman parte del embudo)
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {breakdown.map((item) => (
          <div
            key={item.eventType}
            className="rounded-lg border border-gray-200 dark:border-gray-700 p-3"
          >
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {EVENT_LABELS[item.eventType] ?? item.eventType}
            </p>
            <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{item.users}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
              {item.total} ocurrencias
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
