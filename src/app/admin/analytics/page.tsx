'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTheme } from '@/lib/hooks/useTheme';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Users, CreditCard, TrendingUp, ArrowLeft, Rocket } from 'lucide-react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const ADMIN_EMAIL = 'matias.pagano07@gmail.com';

interface AnalyticsData {
  totalSignups: number;
  totalActivated: number;
  totalPayments: number;
  activationRate: number;
  conversionRate: number;
  signupsByMonth: { month: string; count: number }[];
  activationsByMonth: { month: string; count: number }[];
  paymentsByMonth: { month: string; count: number }[];
  recentEvents: {
    id: string;
    event_type: string;
    user_email: string | null;
    user_name: string | null;
    tenant_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }[];
}

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isDark = useTheme();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.email !== ADMIN_EMAIL) {
      router.replace('/dashboard');
      return;
    }

    async function fetchData() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/admin/analytics', {
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
        });
        if (!res.ok) throw new Error('Error al cargar datos');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido');
      }
    }

    fetchData();
  }, [user, authLoading, router]);

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

  if (error || !data || !user || user.email !== ADMIN_EMAIL) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <Card className="p-8 text-center">
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
    Activados: data.activationsByMonth[i]?.count ?? 0,
    Pagos: data.paymentsByMonth[i]?.count ?? 0,
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
          <p className="text-sm text-gray-500 dark:text-gray-400">Registros → Activados → Pagos</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center">
              <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total registros</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.totalSignups}</p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-500/20 flex items-center justify-center">
              <Rocket className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total activados</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.totalActivated}</p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-500/20 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total pagos</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.totalPayments}</p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Activación</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.activationRate}%</p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Conversión</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.conversionRate}%</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">Registros vs Activados vs Pagos por mes</h2>
        {chartData.some((d) => d.Registros > 0 || d.Activados > 0 || d.Pagos > 0) ? (
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
              <Bar dataKey="Registros" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Activados" fill="#F97316" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Pagos" fill="#22C55E" radius={[4, 4, 0, 0]} />
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
                      {new Date(event.created_at).toLocaleDateString('es-AR', {
                        day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        event.event_type === 'signup'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400'
                          : 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400'
                      }`}>
                        {event.event_type === 'signup' ? 'Registro' : 'Pago'}
                      </span>
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
