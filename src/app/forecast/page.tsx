'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { LoadingState } from '@/components/ui/loading-state';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatCard } from '@/components/ui/stat-card';
import { PageHeader } from '@/components/ui/page-header';
import { TrendingUp, AlertTriangle, ShoppingCart, Banknote, Activity, BarChart3, Flame, Filter, ExternalLink, TrendingDown } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { formatARS } from '@/lib/utils/currency';
import { authFetch } from '@/lib/fetchWithTenant';

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
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<'todos' | 'riesgo' | 'alta' | 'sin'>('riesgo');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/ai/forecast');
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

  const header = (
    <PageHeader
      title="Pronóstico de Demanda"
      subtitle="Planeá tus compras: qué reponer, cuánto gastar y qué productos te están haciendo perder plata."
      icon={
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600">
          <TrendingUp className="h-6 w-6 text-white" />
        </div>
      }
    />
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingState label="Calculando proyecciones de demanda..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        {header}
        <div className="text-center py-20">
          <AlertTriangle className="h-12 w-12 mx-auto text-amber-500 mb-3" />
          <p className="text-lg font-medium text-gray-900 dark:text-gray-100">Error al cargar proyecciones</p>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || data.predictions.length === 0 || data.predictions.every((p) => p.totalSoldLast30 === 0)) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState icon={BarChart3} title="Sin datos suficientes" description="Se necesitan ventas en los últimos 30 días para generar proyecciones." />
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

  // Productos que hoy se venden por debajo de su costo. Sale del catalogo
  // (price_cents vs cost), NO de las ventas historicas: `sale_items` no guarda
  // el costo del momento de la venta, y en este catalogo su `subtotal_cents`
  // historico no es confiable, asi que multiplicar ventas por costo daria
  // numeros inventados. Con el catalogo el hecho es verificable y accionable:
  // "lo estas vendiendo mas barato de lo que te costo".
  // La guarda cost > 0 es defensiva: el forecast service mapea el costo con
  // `Number(product.cost) || 0`, asi que un 0 puede ser "sin cargar" y no un
  // producto gratis. Con precios validos el filtro ya lo excluye igual.
  const lossMaking = data.predictions
    .filter((p) => p.cost > 0 && p.price < p.cost)
    .map((p) => ({
      ...p,
      lossPerUnit: p.cost - p.price,
      marginPct: ((p.price - p.cost) / p.cost) * 100,
      // Estimado: multiplica por unidades vendidas. La cantidad si es confiable,
      // a diferencia de los importes de `sale_items`.
      lossLast30: (p.cost - p.price) * p.totalSoldLast30,
    }))
    .sort((x, y) => y.lossPerUnit - x.lossPerUnit);
  const totalLossLast30 = lossMaking.reduce((acc, p) => acc + p.lossLast30, 0);

  const isPaginated = filteredPredictions.length > PAGE_SIZE;
  const totalPages = isPaginated ? Math.ceil(filteredPredictions.length / PAGE_SIZE) : 1;
  const displayedPredictions = isPaginated
    ? filteredPredictions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : filteredPredictions;

  return (
    <div className="space-y-6">
      {header}

      {/* KPIs orientados a la acción */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Sugerencia de compra"
          value={s.purchaseSuggestion15 > 0 ? formatARS(s.purchaseSuggestion15) : '—'}
          subtitle="Para cubrir los próximos 15 días"
          icon={ShoppingCart}
          tone="emerald"
        />

        <StatCard
          title="Riesgo de quiebre"
          value={s.stockoutRiskCount}
          valueClassName={s.stockoutRiskCount > 0 ? 'text-rose-600 dark:text-rose-400' : undefined}
          subtitle={`${s.stockoutRiskCount === 1 ? 'Se agota' : 'Se agotan'} en menos de 7 días`}
          icon={AlertTriangle}
          tone="rose"
        />

        <StatCard
          title="Capital inmovilizado"
          value={s.immobilizedCapital > 0 ? formatARS(s.immobilizedCapital) : '—'}
          subtitle={`${s.deadStockCount} producto${s.deadStockCount === 1 ? '' : 's'} sin rotación (+30 días)`}
          icon={Banknote}
          tone="amber"
        />

        <StatCard
          title="Efectividad del stock"
          value={
            <>
              {s.productsWithSales} <span className="text-base font-semibold text-gray-400">de {s.totalProducts}</span>
            </>
          }
          subtitle={noRotationPct !== null ? `${noRotationPct}% del stock no rota` : 'Sin datos'}
          icon={Activity}
          tone="indigo"
        />
      </div>

      {/* Distribución del inventario + Próximo a agotarse */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="p-5 lg:col-span-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-emerald-500" />
            Distribución del inventario
          </h2>
          <div className="h-40">
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={100}
              minHeight={160}
              initialDimension={{ width: 100, height: 160 }}
            >
              <BarChart data={inventoryDistribution} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                <Tooltip
                  formatter={(value: unknown) => [`${value} productos`, 'Cantidad']}
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={60} isAnimationActive={false}>
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

      {/* Productos que hoy se venden por debajo de su costo. Si no hay ninguno la
          sección no se muestra: que todos vender por encima del costo es lo normal y
          un cartel de "todo bien" solo suma ruido. */}
      {lossMaking.length > 0 && (
        <Card className="p-5">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-rose-500" />
            Se venden bajo su costo
          </h2>
          <p data-testid="loss-summary" className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Revisá el precio o el costo de cada uno.
            {totalLossLast30 > 0 && (
              <> En los últimos 30 días eso fueron unos{' '}
                <span className="font-semibold text-rose-600 dark:text-rose-400">
                  {formatARS(totalLossLast30)}
                </span>{' '}
                de pérdida.
              </>
            )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Producto</th>
                  <th className="py-3 px-4 text-right">Costo</th>
                  <th className="py-3 px-4 text-right">Precio</th>
                  <th className="py-3 px-4 text-right">Pierde por unidad</th>
                  <th className="py-3 px-4 text-right">Margen</th>
                  <th className="py-3 px-4 text-center">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                {lossMaking.map((p) => (
                  <tr key={p.productId} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="py-3 px-4 font-medium text-gray-900 dark:text-gray-100">
                      {p.productName}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600 dark:text-gray-400">
                      {formatARS(p.cost)}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600 dark:text-gray-400">
                      {formatARS(p.price)}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-rose-600 dark:text-rose-400">
                      −{formatARS(p.lossPerUnit)}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-rose-600 dark:text-rose-400">
                      {p.marginPct.toFixed(0)}%
                    </td>
                    <td className="py-3 px-4 text-center">
                      <a
                        href={`/products?edit=${p.productId}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
                      >
                        Corregir
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
                <span className={`ml-1.5 ${filterTab === tab.key ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-400'}`}>{tab.count}</span>
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
                <tr className="bg-gray-50 dark:bg-gray-900/50 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
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
                      <span className={`font-semibold ${p.totalSoldLast30 === 0 ? 'text-gray-900 dark:text-gray-100' : p.currentStock <= p.minStock ? 'text-rose-600 dark:text-rose-400' : p.needsReorder ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-gray-100'}`}>
                        {p.currentStock}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-center text-gray-600 dark:text-gray-400">{formatDailyDemand(p)}</td>
                    <td className="py-3 px-6 text-center text-gray-600 dark:text-gray-400">
                      {p.daysUntilStockout !== null ? `${p.daysUntilStockout}d` : '—'}
                    </td>
                    <td className="py-3 px-6 text-center">
                      {p.suggestedOrder15 > 0 ? (
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">{p.suggestedOrder15} u.</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-6 text-center">
                      {p.totalSoldLast30 === 0 ? (
                        <StatusBadge size="xs" tone="gray">Sin movimiento</StatusBadge>
                      ) : p.currentStock <= p.minStock ? (
                        <StatusBadge size="xs" tone="rose">Crítico</StatusBadge>
                      ) : p.needsReorder ? (
                        <StatusBadge size="xs" tone="amberSoft">Alerta</StatusBadge>
                      ) : (
                        <StatusBadge size="xs" tone="emeraldSoft">Saludable</StatusBadge>
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
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={setPage}
          resultInfo={`Mostrando ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filteredPredictions.length)} de ${filteredPredictions.length}`}
        />
      </Card>
    </div>
  );
}