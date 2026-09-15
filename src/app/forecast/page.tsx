'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, TrendingUp, AlertTriangle, ShoppingCart, Banknote, Activity, BarChart3, Sparkles, Flame, Filter, ExternalLink } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { formatARS } from '@/lib/utils/currency';

interface Prediction {
  productId: string;
  productName: string;
  currentStock: number;
  minStock: number;
  avgDailySales: number;
  projectedMonthlyDemand: number;
  daysUntilStockout: number | null;
  needsReorder: boolean;
  suggestedOrder: number;
  suggestedOrder15: number;
  totalSoldLast30: number;
  activeDays: number;
  price: number;
  cost: number;
}

interface UpcomingStockout {
  productId: string;
  productName: string;
  currentStock: number;
  daysUntilStockout: number | null;
}

function formatDailyDemand(p: Prediction): string {
  if (p.totalSoldLast30 === 0) return '—';
  if (p.avgDailySales === 0) return '<0.1';
  return String(p.avgDailySales);
}

export default function ForecastPage() {
  const { role, tenant, loading: authLoading } = useAuth();
  const router = useRouter();

  const [data, setData] = useState<{
    predictions: Prediction[];
    topProducts: Prediction[];
    needsReorder: Prediction[];
    upcomingStockout: UpcomingStockout[];
    summary: {
      totalSales30: number;
      totalTransactions30: number;
      productsWithSales: number;
      totalProducts: number;
      needsReorderCount: number;
      stockoutRiskCount: number;
      deadStockCount: number;
      immobilizedCapital: number;
      purchaseSuggestion15: number;
      stockEffectivenessPct: number | null;
    };
    trends: {
      totalSales: number | null;
      transactions: number | null;
      productsWithSales: number | null;
      needsReorder: number | null;
    } | null;
    aiAnalysis: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<'todos' | 'riesgo' | 'alta' | 'sin'>('riesgo');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = {};
        if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
        const res = await fetch('/api/ai/forecast', { headers });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error'); }
        setData(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!authLoading && role === 'member') { router.replace('/dashboard'); return; }
    if (!authLoading && tenant && (tenant.subscription_plan === 'free' || tenant.subscription_plan === 'starter')) {
      router.replace('/dashboard');
    }
  }, [role, router, tenant, authLoading]);

  if (authLoading || role === 'member') return null;

  const isStarter = !authLoading && tenant && (tenant.subscription_plan === 'free' || tenant.subscription_plan === 'starter');
  if (!authLoading && isStarter) return null;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        <p className="text-sm text-gray-500">Calculando proyecciones de demanda...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <AlertTriangle className="h-12 w-12 mx-auto text-amber-500 mb-3" />
        <p className="text-lg font-medium text-gray-900 dark:text-gray-100">Error al cargar proyecciones</p>
        <p className="text-sm text-gray-500 mt-1">{error}</p>
      </div>
    );
  }

  if (!data || data.predictions.length === 0 || data.predictions.every((p) => p.totalSoldLast30 === 0)) {
    return (
      <div className="text-center py-20">
        <BarChart3 className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-lg font-medium text-gray-900 dark:text-gray-100">Sin datos suficientes</p>
        <p className="text-sm text-gray-500 mt-1">Se necesitan ventas en los últimos 30 días para generar proyecciones.</p>
      </div>
    );
  }

  const totalDailySales = data.predictions.reduce((s, p) => s + p.avgDailySales, 0);
  const avgDailyAll = (() => {
    const withSales = data.predictions.filter((p) => p.totalSoldLast30 > 0);
    return withSales.length > 0 ? totalDailySales / withSales.length : 0;
  })();

  const s = data.summary;
  const noRotationPct = s.stockEffectivenessPct !== null ? 100 - s.stockEffectivenessPct : null;

  let nEnRiesgo = 0;
  let nReponer = 0;
  let nInmovilizado = 0;
  let nSaludable = 0;
  for (const p of data.predictions) {
    if (p.totalSoldLast30 === 0) { nInmovilizado += 1; continue; }
    if ((p.daysUntilStockout !== null && p.daysUntilStockout <= 7) || p.currentStock <= p.minStock) { nEnRiesgo += 1; continue; }
    if (p.needsReorder) { nReponer += 1; continue; }
    nSaludable += 1;
  }
  const inventoryDistribution = [
    { name: 'En riesgo', count: nEnRiesgo, color: '#ef4444' },
    { name: 'Reponer', count: nReponer, color: '#f59e0b' },
    { name: 'Sin rotación', count: nInmovilizado, color: '#9ca3af' },
    { name: 'Saludable', count: nSaludable, color: '#10b981' },
  ];

  const filteredPredictions = data.predictions.filter((p) => {
    if (filterTab === 'todos') return true;
    if (filterTab === 'riesgo') return p.totalSoldLast30 > 0 && (p.needsReorder || p.currentStock <= p.minStock);
    if (filterTab === 'alta') return avgDailyAll > 0 && p.avgDailySales > avgDailyAll;
    if (filterTab === 'sin') return p.totalSoldLast30 === 0;
    return true;
  });

  const isPaginated = filteredPredictions.length > PAGE_SIZE;
  const totalPages = isPaginated ? Math.ceil(filteredPredictions.length / PAGE_SIZE) : 1;
  const displayedPredictions = isPaginated
    ? filteredPredictions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : filteredPredictions;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600">
          <TrendingUp className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Pronóstico de Demanda</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Planeá tus compras: qué reponer, cuánto gastar y qué productos te están haciendo perder plata.
          </p>
        </div>
      </div>

      {/* KPIs orientados a la acción */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Sugerencia de compra</p>
            <div className="flex-shrink-0 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400">
              <ShoppingCart className="h-5 w-5" />
            </div>
          </div>
          <p className="text-2xl font-bold mt-1 text-gray-900 dark:text-white">
            {s.purchaseSuggestion15 > 0 ? formatARS(s.purchaseSuggestion15) : '—'}
          </p>
          <p className="text-xs text-gray-500 mt-1">Para cubrir los próximos 15 días</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Riesgo de quiebre</p>
              <p className={`text-2xl font-bold mt-1 ${s.stockoutRiskCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-900 dark:text-white'}`}>
                {s.stockoutRiskCount}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {s.stockoutRiskCount === 1 ? 'Se agota' : 'Se agotan'} en menos de 7 días
              </p>
            </div>
            <div className="flex-shrink-0 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Capital inmovilizado</p>
              <p className="text-2xl font-bold mt-1 text-gray-900 dark:text-white">
                {s.immobilizedCapital > 0 ? formatARS(s.immobilizedCapital) : '—'}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {s.deadStockCount} producto{s.deadStockCount === 1 ? '' : 's'} sin rotación (+30 días)
              </p>
            </div>
            <div className="flex-shrink-0 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400">
              <Banknote className="h-5 w-5" />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Efectividad del stock</p>
              <p className="text-2xl font-bold mt-1 text-gray-900 dark:text-white">
                {s.productsWithSales} <span className="text-base font-semibold text-gray-400">de {s.totalProducts}</span>
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {noRotationPct !== null ? `${noRotationPct}% del stock no rota` : 'Sin datos'}
              </p>
            </div>
            <div className="flex-shrink-0 p-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400">
              <Activity className="h-5 w-5" />
            </div>
          </div>
        </Card>
      </div>

      {/* AI Analysis */}
      {data.aiAnalysis && (
        <Card className="p-5 border-l-4 border-l-indigo-500">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-indigo-500 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Análisis IA</p>
              <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{data.aiAnalysis}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Distribución del inventario + Próximo a agotarse */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="p-5 lg:col-span-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-emerald-500" />
            Distribución del inventario
          </h2>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={160}>
              <BarChart data={inventoryDistribution} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                <Tooltip
                  formatter={(value: unknown) => [`${value} productos`, 'Cantidad']}
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={60}>
                  {inventoryDistribution.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> En riesgo</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Reponer</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gray-400" /> Sin rotación</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Saludable</span>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Flame className="h-5 w-5 text-rose-500" />
              Próximo a agotarse
            </h2>
            {data.upcomingStockout.length === 0 ? (
              <div className="flex items-center gap-2.5 text-sm">
                <span className="text-base">🎉</span>
                <span className="text-gray-700 dark:text-gray-300">Sin productos próximos a agotarse</span>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                {data.upcomingStockout.map((p, i) => {
                  const urgent = p.daysUntilStockout !== null && p.daysUntilStockout <= 7;
                  return (
                    <div key={p.productId} className="flex items-center gap-2.5">
                      <span className={`flex-shrink-0 w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center ${
                        urgent
                          ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400'
                          : 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400'
                      }`}>
                        {i + 1}
                      </span>
                      <span className="text-gray-700 dark:text-gray-300">
                        <strong className="text-gray-900 dark:text-white">{p.productName}</strong>{' '}
                        — quedan {p.currentStock} u.
                        {p.daysUntilStockout !== null && (
                          <> → se agota en <strong className={urgent ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}>{p.daysUntilStockout} días</strong></>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Filtered predictions */}
      <Card className="overflow-hidden border border-gray-100 dark:border-gray-800 p-0">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Filter className="h-5 w-5 text-gray-400" />
            Productos
          </h2>
          <div className="flex gap-1.5">
            {([
              { key: 'riesgo', label: 'En riesgo', count: data.predictions.filter((p) => p.totalSoldLast30 > 0 && (p.needsReorder || p.currentStock <= p.minStock)).length },
              { key: 'todos', label: 'Todos', count: data.predictions.length },
              { key: 'alta', label: 'Alta demanda', count: data.predictions.filter((p) => avgDailyAll > 0 && p.avgDailySales > avgDailyAll).length },
              { key: 'sin', label: 'Sin movimiento', count: data.predictions.filter((p) => p.totalSoldLast30 === 0).length },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setFilterTab(tab.key); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  filterTab === tab.key
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                }`}
              >
                {tab.label}
                <span className={`ml-1.5 ${filterTab === tab.key ? 'opacity-70' : 'opacity-50'}`}>{tab.count}</span>
              </button>
            ))}
          </div>
        </div>
        {filteredPredictions.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            No hay productos en esta categoría.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-6">Producto</th>
                  <th className="py-3 px-6 text-center">Stock</th>
                  <th className="py-3 px-6 text-center">Demanda/día</th>
                  <th className="py-3 px-6 text-center">Cobertura</th>
                  <th className="py-3 px-6 text-center">Cantidad a pedir</th>
                  <th className="py-3 px-6 text-center">Estado</th>
                  <th className="py-3 px-6 text-center">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                {displayedPredictions.map((p) => (
                  <tr key={p.productId} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="py-3 px-6 font-medium text-gray-900 dark:text-gray-100">{p.productName}</td>
                    <td className="py-3 px-6 text-center">
                      <span className={`font-semibold ${p.totalSoldLast30 === 0 ? 'text-gray-900 dark:text-gray-100' : p.currentStock <= p.minStock ? 'text-rose-600' : p.needsReorder ? 'text-amber-600' : 'text-gray-900 dark:text-gray-100'}`}>
                        {p.currentStock}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-center text-gray-600">{formatDailyDemand(p)}</td>
                    <td className="py-3 px-6 text-center text-gray-600">
                      {p.daysUntilStockout !== null ? `${p.daysUntilStockout}d` : '—'}
                    </td>
                    <td className="py-3 px-6 text-center">
                      {p.suggestedOrder15 > 0 ? (
                        <span className="font-semibold text-indigo-600">{p.suggestedOrder15} u.</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-6 text-center">
                      {p.totalSoldLast30 === 0 ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400 rounded-full px-2 py-0.5">
                          Sin movimiento
                        </span>
                      ) : p.currentStock <= p.minStock ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400 rounded-full px-2 py-0.5">
                          Crítico
                        </span>
                      ) : p.needsReorder ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 rounded-full px-2 py-0.5">
                          Alerta
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400 rounded-full px-2 py-0.5">
                          Saludable
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-6 text-center">
                      {p.suggestedOrder15 > 0 ? (
                        <a
                          href={`/providers?create_po=1&productId=${p.productId}&qty=${p.suggestedOrder15}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors whitespace-nowrap"
                        >
                          Crear orden
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isPaginated && totalPages > 1 && (
          <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredPredictions.length)} de {filteredPredictions.length}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .reduce<(number | '...')[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === '...' ? (
                    <span key={`dots-${i}`} className="px-1 text-gray-400 text-xs">…</span>
                  ) : (
                    <Button
                      key={p}
                      variant={page === p ? 'primary' : 'outline'}
                      size="sm"
                      onClick={() => setPage(p)}
                      className="min-w-[28px] px-1"
                    >
                      {p}
                    </Button>
                  )
                )}
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}