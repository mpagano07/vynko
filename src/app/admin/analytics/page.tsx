'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTheme } from '@/lib/hooks/useTheme';
import { authFetch } from '@/lib/fetchWithTenant';
import { formatDate, formatTime } from '@/lib/utils/format';
import { Card } from '@/components/ui/card';
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

import { isAdminProfile } from '@/lib/admin';
import { formatEventDetails } from '@/lib/analytics-event-details';
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
          <div className="overflow-x-auto -mx-1">
            <table className="w-full min-w-[640px] text-left border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-[9.5rem]">Cuándo</th>
                  <th className="py-2.5 px-3 w-[10rem]">Evento</th>
                  <th className="py-2.5 px-3">Persona</th>
                  <th className="py-2.5 px-3 w-[16rem]">Detalles</th>
                </tr>
              </thead>
              <tbody>
                {data.recentEvents.map((event) => (
                  <RecentEventRow key={event.id} event={event} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// Tono por tipo de evento, para que la columna se lea de un vistazo en vez de
// ser toda azul. Los pasos del embudo van en azul; lo que se pierde (cancelo)
// en rojo; lo demas, neutro.
const EVENT_TONES: Record<string, StatusTone> = {
  signup: 'indigo',
  company_created: 'indigo',
  trial_started: 'indigo',
  product_created: 'blue',
  excel_import: 'blue',
  first_sale: 'emerald',
  first_cash_open: 'emerald',
  first_purchase: 'emerald',
  app_return: 'emerald',
  subscription_started: 'green',
  subscription_cancelled: 'red',
  document_created: 'gray',
  forecast_opened: 'gray',
  whatsapp_ticket: 'gray',
};

function RecentEventRow({ event }: { event: AdminAnalytics['recentEvents'][number] }) {
  const { details, reconstructed, clamped } = formatEventDetails(event.metadata);

  return (
    <tr className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 align-top">
      <td className="py-2.5 px-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap tabular-nums">
        {/* Numerico y no "29 de sept de 26": con el año, month:'short' salta
            al formato con "de" y la celda se ensancha. */}
        <span className="block">
          {formatDate(event.created_at, { day: '2-digit', month: '2-digit', year: '2-digit' })}
        </span>
        <span className="block text-gray-400 dark:text-gray-500">
          {formatTime(event.created_at)}
        </span>
      </td>

      <td className="py-2.5 px-3">
        <StatusBadge tone={EVENT_TONES[event.event_type] ?? 'gray'} size="xs">
          {EVENT_LABELS[event.event_type] ?? event.event_type}
        </StatusBadge>
        {reconstructed && (
          <span className="mt-1 block">
            <StatusBadge tone="amberSoft" size="xs" title="Reconstruido por el backfill a partir de actividad real, no registrado en vivo.">
              reconstruido
            </StatusBadge>
          </span>
        )}
        {clamped && (
          <span className="mt-1 block">
            <StatusBadge tone="amberSoft" size="xs" title="La fecha fue adelantada a la primera actividad real porque tenants.created_at no era confiable.">
              fecha ajustada
            </StatusBadge>
          </span>
        )}
      </td>

      <td className="py-2.5 px-3">
        {event.user_email ? (
          <>
            <span className="block text-gray-700 dark:text-gray-200 truncate">{event.user_email}</span>
            {event.user_name && (
              <span className="block text-xs text-gray-400 dark:text-gray-500 truncate">{event.user_name}</span>
            )}
          </>
        ) : (
          <span className="text-gray-400 dark:text-gray-600">sin identificar</span>
        )}
      </td>

      <td className="py-2.5 px-3">
        {details.length === 0 ? (
          <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>
        ) : (
          <ul className="space-y-0.5">
            {details.map((d, i) => (
              <li key={`${d.label ?? 'v'}-${i}`} className="text-xs leading-relaxed">
                {d.label && (
                  <span className="text-gray-400 dark:text-gray-500">{d.label}: </span>
                )}
                <span className="text-gray-700 dark:text-gray-200">{d.value}</span>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
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
