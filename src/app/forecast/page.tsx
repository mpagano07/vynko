'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, TrendingUp, TrendingDown, AlertTriangle, Package, DollarSign, BarChart3, Sparkles, Lightbulb, ShieldCheck, Filter, ExternalLink } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
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
  totalSoldLast30: number;
  activeDays: number;
  price: number;
  cost: number;
}

export default function ForecastPage() {
  const { role, tenant, loading: authLoading } = useAuth();
  const router = useRouter();

  const [data, setData] = useState<{
    predictions: Prediction[];
    topProducts: Prediction[];
    needsReorder: Prediction[];
    summary: any;
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
  const [filterTab, setFilterTab] = useState<'todos' | 'riesgo' | 'alta' | 'sin'>('todos');
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
      } catch (err: any) {
        setError(err.message);
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

  if (!data || data.predictions.length === 0) {
    return (
      <div className="text-center py-20">
        <BarChart3 className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-lg font-medium text-gray-900 dark:text-gray-100">Sin datos suficientes</p>
        <p className="text-sm text-gray-500 mt-1">Se necesitan ventas en los últimos 30 días para generar proyecciones.</p>
      </div>
    );
  }

  const chartData = data.topProducts.map((p) => ({
    name: p.productName.length > 12 ? p.productName.slice(0, 12) + '...' : p.productName,
    'Venta diaria': p.avgDailySales,
    'Demanda proyectada': p.projectedMonthlyDemand / 30,
  }));

  const criticalStockout = data.predictions.filter(
    (p) => p.daysUntilStockout !== null && p.daysUntilStockout <= 7
  );
  const totalDailySales = data.predictions.reduce((s, p) => s + p.avgDailySales, 0);
  const top3Sales = data.topProducts.slice(0, 3).reduce((s, p) => s + p.avgDailySales, 0);
  const top3Pct = totalDailySales > 0 ? Math.round((top3Sales / totalDailySales) * 100) : 0;
  const avgDailyAll = data.predictions.length > 0 ? totalDailySales / data.predictions.length : 0;
  const highDemandProducts = data.predictions.filter((p) => avgDailyAll > 0 && p.avgDailySales > avgDailyAll * 2).length;

  const totalStock = data.predictions.reduce((s, p) => s + p.currentStock, 0);
  const inventoryCoverageDays = totalDailySales > 0 ? Math.round(totalStock / totalDailySales) : null;
  const totalReorderCost = data.needsReorder.reduce((s, p) => s + (p.suggestedOrder * p.cost), 0);
  const growingProducts = data.predictions.filter((p) => p.activeDays >= 20).length;

  const filteredPredictions = data.predictions.filter((p) => {
    if (filterTab === 'todos') return true;
    if (filterTab === 'riesgo') return p.needsReorder || p.currentStock <= p.minStock;
    if (filterTab === 'alta') return avgDailyAll > 0 && p.avgDailySales > avgDailyAll;
    if (filterTab === 'sin') return p.totalSoldLast30 === 0 || p.activeDays <= 3;
    return true;
  });

  const isPaginated = filterTab === 'todos' && filteredPredictions.length > PAGE_SIZE;
  const totalPages = isPaginated ? Math.ceil(filteredPredictions.length / PAGE_SIZE) : 1;
  const displayedPredictions = isPaginated
    ? filteredPredictions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : filteredPredictions;

  function TrendBadge({ value }: { value: number | null }) {
    if (value === null) return null;
    const isUp = value > 0;
    const isDown = value < 0;
    if (!isUp && !isDown) return null;
    return (
      <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold rounded-full px-1.5 py-0.5 ${
        isUp
          ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400'
          : 'text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400'
      }`}>
        {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {isUp ? '+' : ''}{value}%
      </span>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600">
          <TrendingUp className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Pronóstico de Demanda</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Proyecciones basadas en los últimos 30 días de ventas</p>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Ventas 30 días</p>
              <p className="text-2xl font-bold mt-1 text-gray-900 dark:text-white">{formatARS(data.summary.totalSales30)}</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-gray-500">{data.summary.totalTransactions30} transacciones</p>
                <TrendBadge value={data.trends?.totalSales ?? null} />
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600">
              <DollarSign className="h-5 w-5" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Productos con ventas</p>
              <p className="text-2xl font-bold mt-1 text-gray-900 dark:text-white">{data.summary.productsWithSales}</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-gray-500">de {data.summary.totalProducts} registrados</p>
                <TrendBadge value={data.trends?.productsWithSales ?? null} />
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-600">
              <Package className="h-5 w-5" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Cobertura inventario</p>
              <p className="text-2xl font-bold mt-1 text-gray-900 dark:text-white">
                {inventoryCoverageDays !== null ? `${inventoryCoverageDays} días` : '—'}
              </p>
              <p className="text-xs text-gray-500 mt-1">Stock actual vs demanda diaria</p>
            </div>
            <div className="p-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Top producto</p>
              <p className="text-lg font-bold mt-1 text-gray-900 dark:text-white truncate">
                {data.topProducts[0]?.productName || '—'}
              </p>
              <p className="text-xs text-gray-500 mt-1">{data.topProducts[0]?.avgDailySales || 0} unidades/día</p>
              {(() => {
                const top = data.topProducts[0]?.avgDailySales || 0;
                const avg = data.predictions.length > 0
                  ? data.predictions.reduce((sum, p) => sum + p.avgDailySales, 0) / data.predictions.length
                  : 0;
                if (avg > 0) {
                  const pct = Math.round(((top - avg) / avg) * 100);
                  if (pct > 0) {
                    return (
                      <span className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400 rounded-full px-2 py-0.5">
                        ⬆ +{pct}% vs promedio
                      </span>
                    );
                  }
                }
                return null;
              })()}
            </div>
            <div className="p-2.5 rounded-lg bg-purple-50 dark:bg-purple-950/30 text-purple-600">
              <TrendingUp className="h-5 w-5" />
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

      {/* Top Products Chart + Resumen Inteligente */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="p-5 lg:col-span-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-emerald-500" />
            Top 5 Productos por Demanda Diaria
          </h2>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <Tooltip
                  formatter={(value: any) => [Number(value).toFixed(1), 'Unidades/día']}
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}
                />
                <Bar dataKey="Venta diaria" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-amber-500" />
              Resumen Inteligente
            </h2>
            <div className="space-y-3 text-sm">
              {criticalStockout.length > 0 ? (
                <div className="flex items-center gap-2.5">
                  <span className="text-base">🔴</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    <strong className="text-rose-600 dark:text-rose-400">{criticalStockout.length}</strong> {criticalStockout.length === 1 ? 'producto se agota' : 'productos se agotan'} esta semana
                  </span>
                </div>
              ) : data.needsReorder.length === 0 ? (
                <div className="flex items-center gap-2.5">
                  <span className="text-base">🟢</span>
                  <span className="text-gray-700 dark:text-gray-300">Inventario saludable, sin stock crítico</span>
                </div>
              ) : null}
              {data.needsReorder.length > 0 && (
                <div className="flex items-center gap-2.5">
                  <span className="text-base">⚠️</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    <strong className="text-amber-600 dark:text-amber-400">{data.needsReorder.length}</strong> {data.needsReorder.length === 1 ? 'producto requiere' : 'productos requieren'} reposición
                  </span>
                </div>
              )}
              {growingProducts > 0 && (
                <div className="flex items-center gap-2.5">
                  <span className="text-base">📈</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    <strong className="text-blue-600 dark:text-blue-400">{growingProducts}</strong> {growingProducts === 1 ? 'producto está' : 'productos están'} en constante demanda
                  </span>
                </div>
              )}
              {top3Pct >= 50 && (
                <div className="flex items-center gap-2.5">
                  <span className="text-base">🏆</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    Top 3 concentra el <strong className="text-violet-600 dark:text-violet-400">{top3Pct}%</strong> de las ventas
                  </span>
                </div>
              )}
              {totalReorderCost > 0 && (
                <div className="flex items-center gap-2.5">
                  <span className="text-base">💰</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    Inversión recomendada: <strong className="text-gray-900 dark:text-white">{formatARS(totalReorderCost)}</strong>
                  </span>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Products needing reorder */}
      {data.needsReorder.length > 0 && (
        <Card className="overflow-hidden border border-gray-100 dark:border-gray-800 p-0">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Productos que necesitan reposición
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-6">Producto</th>
                  <th className="py-3 px-6 text-center">Stock actual</th>
                  <th className="py-3 px-6 text-center">Venta diaria</th>
                  <th className="py-3 px-6 text-center">Proyección mensual</th>
                  <th className="py-3 px-6 text-center">Días hasta agotar</th>
                  <th className="py-3 px-6 text-center">Sugerido a ordenar</th>
                  <th className="py-3 px-6 text-center">Costo estimado</th>
                  <th className="py-3 px-6 text-center">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                {data.needsReorder.map((p) => (
                  <tr key={p.productId} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="py-3 px-6 font-semibold text-gray-900 dark:text-gray-100">{p.productName}</td>
                    <td className="py-3 px-6 text-center">
                      <span className={`inline-flex font-bold ${p.currentStock <= p.minStock ? 'text-rose-600' : 'text-amber-600'}`}>
                        {p.currentStock}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-center text-gray-600">{p.avgDailySales}</td>
                    <td className="py-3 px-6 text-center text-gray-600">{p.projectedMonthlyDemand} u.</td>
                    <td className="py-3 px-6 text-center">
                      {p.daysUntilStockout !== null ? (
                        <span className={p.daysUntilStockout <= 7 ? 'text-rose-600 font-semibold' : 'text-gray-600'}>
                          {p.daysUntilStockout} días
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-6 text-center font-semibold text-indigo-600">{p.suggestedOrder} u.</td>
                    <td className="py-3 px-6 text-center font-semibold text-gray-900 dark:text-white">
                      {p.cost > 0 ? formatARS(p.suggestedOrder * p.cost) : '—'}
                    </td>
                    <td className="py-3 px-6 text-center">
                      <a
                        href={`/providers?productId=${p.productId}&qty=${p.suggestedOrder}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                      >
                        Crear orden
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Filtered predictions */}
      <Card className="overflow-hidden border border-gray-100 dark:border-gray-800 p-0">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Filter className="h-5 w-5 text-gray-400" />
            Productos
          </h2>
          <div className="flex gap-1.5">
            {([
              { key: 'todos', label: 'Todos', count: data.predictions.length },
              { key: 'riesgo', label: 'En riesgo', count: data.predictions.filter((p) => p.needsReorder || p.currentStock <= p.minStock).length },
              { key: 'alta', label: 'Alta demanda', count: data.predictions.filter((p) => avgDailyAll > 0 && p.avgDailySales > avgDailyAll).length },
              { key: 'sin', label: 'Sin movimiento', count: data.predictions.filter((p) => p.totalSoldLast30 === 0 || p.activeDays <= 3).length },
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
                  <th className="py-3 px-6 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                {displayedPredictions.map((p) => (
                  <tr key={p.productId} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="py-3 px-6 font-medium text-gray-900 dark:text-gray-100">{p.productName}</td>
                    <td className="py-3 px-6 text-center">
                      <span className={`font-semibold ${p.currentStock <= p.minStock ? 'text-rose-600' : p.needsReorder ? 'text-amber-600' : 'text-gray-900 dark:text-gray-100'}`}>
                        {p.currentStock}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-center text-gray-600">{p.avgDailySales}</td>
                    <td className="py-3 px-6 text-center text-gray-600">
                      {p.daysUntilStockout !== null ? `${p.daysUntilStockout}d` : '—'}
                    </td>
                    <td className="py-3 px-6 text-center">
                      {p.currentStock <= p.minStock ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400 rounded-full px-2 py-0.5">
                          Crítico
                        </span>
                      ) : p.needsReorder ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 rounded-full px-2 py-0.5">
                          Alerta
                        </span>
                      ) : p.totalSoldLast30 === 0 || p.activeDays <= 3 ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400 rounded-full px-2 py-0.5">
                          Sin movimiento
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400 rounded-full px-2 py-0.5">
                          Saludable
                        </span>
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
