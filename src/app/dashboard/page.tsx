"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useProducts } from '@/lib/hooks/useProducts';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, BarChart3, Plus, ShoppingCart, Package,
  Activity, Clock, ArrowUpRight, ArrowDownRight, Minus, Lightbulb,
} from 'lucide-react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const CHART_PERIODS = [
  { label: '7 días', days: 7 },
  { label: '30 días', days: 30 },
  { label: '90 días', days: 90 },
  { label: '12 meses', days: 365 },
];

const SUGGESTIONS = [
  { text: 'Agregá colaboradores para que cada empleado tenga su propio usuario.', cta: 'Configurar', href: '/settings' },
  { text: 'Activá códigos QR para que tus productos se escaneen al instante.', cta: 'Activar', href: '/codigos' },
  { text: 'Registrá una compra para mantener el stock siempre actualizado.', cta: 'Registrar', href: '/providers' },
  { text: 'Creá categorías para encontrar tus productos más rápido.', cta: 'Crear', href: '/products' },
  { text: 'Configurá los impuestos para facturar correctamente.', cta: 'Configurar', href: '/facturacion' },
];

interface MonthlyData {
  total: number;
  saleCount: number;
  prevTotal: number;
  variationPercent: number | null;
  avgTicket: number;
}

interface ActivityLog {
  id: string;
  action: string;
  entity_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

function actionInfo(action: string, entityType: string, details: Record<string, unknown>): { emoji: string; label: string; detail: string } {
  const name = (details.products as string) || (details.name as string) || '';
  switch (entityType) {
    case 'sale': return { emoji: '🛒', label: 'Venta', detail: name || `#${(details.folio as string) || ''}` };
    case 'product': return action === 'created'
      ? { emoji: '📦', label: 'Producto', detail: name }
      : { emoji: '✏️', label: 'Producto', detail: name || 'Modificado' };
    case 'customer': return { emoji: '👤', label: 'Cliente', detail: name || (action === 'created' ? 'Agregado' : 'Modificado') };
    case 'supplier': return { emoji: '🚚', label: 'Compra', detail: name || (action === 'created' ? 'Registrada' : 'Modificada') };
    default: return { emoji: '📋', label: entityType, detail: '' };
  }
}

export default function DashboardPage() {
  const router = useRouter();
  const { profile, tenant, loading: authLoading, isAuthenticated } = useAuth();
  const { products, isLoading: productsLoading } = useProducts(tenant?.id);

  useEffect(() => {
    if (!authLoading && isAuthenticated && !tenant) router.replace('/onboarding');
  }, [authLoading, isAuthenticated, tenant, router]);

  const [salesData, setSalesData] = useState<{ todayTotal: number; saleCount: number } | null>(null);
  const [salesLoading, setSalesLoading] = useState(true);
  const [salesChartData, setSalesChartData] = useState<{ date: string; day: string; total: number }[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartDays, setChartDays] = useState(7);
  const [monthlyData, setMonthlyData] = useState<MonthlyData | null>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [stockAnalysis, setStockAnalysis] = useState<{ id: string; lastSale: string | null }[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<{
    topProduct: { name: string; qty: number } | null;
    topCustomer: { name: string; total: number } | null;
    lastPurchase: { date: string | null } | null;
    topSupplier: { name: string } | null;
  } | null>(null);

  const criticalProducts = products?.filter(p => (p.stock ?? 0) <= (p.min_stock ?? 0)) || [];

  const fetchChartData = useCallback(async (days: number) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
      const res = await fetch(`/api/sales/summary?days=${days}`, { headers });
      if (res.ok) setSalesChartData(await res.json());
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = {};
        if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

        const [salesRes, summaryRes, monthlyRes, activityRes, stockRes, dashRes] = await Promise.all([
          fetch('/api/sales', { headers }),
          fetch(`/api/sales/summary?days=${chartDays}`, { headers }),
          fetch('/api/sales/monthly', { headers }),
          fetch('/api/activity-logs?limit=5', { headers }),
          fetch('/api/products/stock-analysis', { headers }),
          fetch('/api/dashboard/summary', { headers }),
        ]);

        if (cancelled) return;

        if (salesRes.ok) {
          const sales: Record<string, unknown>[] = await salesRes.json();
          const today = new Date();
          const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
          const todaySales = sales.filter(s => (s.created_at as string) >= todayStart);
          setSalesData({
            todayTotal: todaySales.reduce((sum, s) => sum + ((s.total_cents as number) || 0), 0),
            saleCount: todaySales.length,
          });
        }
        if (summaryRes.ok) setSalesChartData(await summaryRes.json());
        if (monthlyRes.ok) setMonthlyData(await monthlyRes.json());
        if (activityRes.ok) {
          const d = await activityRes.json();
          setRecentActivity(d.data || []);
        }
        if (stockRes.ok) setStockAnalysis(await stockRes.json());
        if (dashRes.ok) setDashboardSummary(await dashRes.json());
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) {
          setSalesLoading(false);
          setChartLoading(false);
          setActivityLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [tenant?.id]);

  useEffect(() => {
    if (chartLoading) return;
    fetchChartData(chartDays);
  }, [chartDays, chartLoading, fetchChartData]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || productsLoading || salesLoading) {
    return (
      <div className="space-y-6 max-w-5xl">
        <div className="h-7 bg-gray-200 dark:bg-gray-800 rounded w-48 animate-pulse" />
        <div className="h-10 bg-gray-200 dark:bg-gray-800 rounded w-full animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="h-24 bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <Card className="lg:col-span-2 h-40 bg-gray-100 dark:bg-gray-800 animate-pulse" />
          <Card className="h-40 bg-gray-100 dark:bg-gray-800 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const criticalCount = criticalProducts.length;
  const todaySalesCount = salesData?.saleCount ?? 0;
  const hasSalesToday = todaySalesCount > 0;

  let statusMessage = '';
  let statusIcon = '';
  let statusColor = '';
  if (!hasSalesToday) {
    statusIcon = '🔴';
    statusMessage = 'Hoy todavía no registraste ventas.';
    statusColor = 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/30';
  } else if (criticalCount > 0) {
    statusIcon = '🟡';
    statusMessage = `Tenés ${criticalCount} producto${criticalCount !== 1 ? 's' : ''} con stock crítico.`;
    statusColor = 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/30';
  } else {
    statusIcon = '🟢';
    statusMessage = 'Todo está funcionando correctamente.';
    statusColor = 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/30';
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Hola, {profile?.full_name?.split(' ')[0] || 'Usuario'} 👋
          </h1>
          {tenant && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{tenant.name}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/sales">
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 h-8 px-3 text-sm font-medium">
              <Plus className="h-3.5 w-3.5" />
              Nueva venta
            </Button>
          </Link>
          <Link href="/products">
            <Button size="sm" variant="outline" className="gap-1.5 h-8 px-3 text-sm font-medium">
              <Package className="h-3.5 w-3.5" />
              Nuevo producto
            </Button>
          </Link>
          <Link href="/providers">
            <Button size="sm" variant="outline" className="gap-1.5 h-8 px-3 text-sm font-medium">
              <ShoppingCart className="h-3.5 w-3.5" />
              Nueva compra
            </Button>
          </Link>
        </div>
      </div>

      {/* Status band */}
      <Link
        href={criticalCount > 0 ? '/products' : !hasSalesToday ? '/sales' : '#'}
        className={`flex items-center justify-between px-4 py-2.5 rounded-lg border text-sm transition-opacity hover:opacity-80 ${statusColor}`}
      >
        <div className="flex items-center gap-2">
          <span>{statusIcon}</span>
          <span className="font-medium text-gray-800 dark:text-gray-200">{statusMessage}</span>
        </div>
        {(criticalCount > 0 || !hasSalesToday) && (
          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 whitespace-nowrap ml-4">
            Ver detalle →
          </span>
        )}
      </Link>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Ventas hoy */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">Ventas hoy</span>
          </div>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            ${salesData ? (salesData.todayTotal / 100).toFixed(2) : '0.00'}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {hasSalesToday ? `${todaySalesCount} venta${todaySalesCount !== 1 ? 's' : ''}` : 'Sin ventas'}
          </p>
        </Card>

        {/* Ingresos del mes */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">Ingresos del mes</span>
            {monthlyData?.variationPercent !== null && monthlyData?.variationPercent !== undefined && (
              <span className={`flex items-center gap-0.5 text-[11px] font-semibold ${
                monthlyData.variationPercent > 0 ? 'text-emerald-600 dark:text-emerald-400'
                : monthlyData.variationPercent < 0 ? 'text-rose-600 dark:text-rose-400'
                : 'text-gray-400'
              }`}>
                {monthlyData.variationPercent > 0 ? <ArrowUpRight className="h-3 w-3" />
                  : monthlyData.variationPercent < 0 ? <ArrowDownRight className="h-3 w-3" />
                  : <Minus className="h-3 w-3" />}
                {monthlyData.variationPercent > 0 ? '+' : ''}{monthlyData.variationPercent}%
              </span>
            )}
          </div>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            ${monthlyData ? monthlyData.total.toFixed(2) : '0.00'}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Ticket promedio: ${monthlyData?.avgTicket?.toFixed(2) ?? '0.00'}
          </p>
        </Card>

        {/* Stock crítico */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">Stock crítico</span>
          </div>
          <p className={`text-xl font-bold ${criticalCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-900 dark:text-white'}`}>
            {criticalCount}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {criticalCount > 0 ? 'productos por reponer' : 'todo en orden'}
          </p>
        </Card>

        {/* Estado */}
        <Card className="p-4">
          <span className="text-xs text-gray-500 dark:text-gray-400">Estado</span>
          <div className="mt-2">
            <p className="text-sm font-medium text-gray-900 dark:text-white leading-snug">
              {!hasSalesToday ? 'Sin ventas hoy' : criticalCount > 0 ? 'Stock bajo' : 'Todo OK'}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {!hasSalesToday ? 'Registra tu primera venta' : criticalCount > 0 ? 'Reponé stock pronto' : 'Negocio funcionando'}
            </p>
          </div>
        </Card>
      </div>

      {/* Alertas de stock + Actividad */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Alertas de stock */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-900 dark:text-white">Alertas de stock</h2>
            {criticalCount > 5 && (
              <Link href="/products" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Ver todas →</Link>
            )}
          </div>
          {criticalCount === 0 ? (
            <Card className="p-6 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <span className="text-sm">✅</span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Sin productos en estado crítico.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {criticalProducts.slice(0, 5).map((product) => {
                const analysis = stockAnalysis.find(s => s.id === product.id);
                const lastSaleText = analysis?.lastSale ? timeAgo(analysis.lastSale) : null;
                return (
                  <Card key={product.id} className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${product.stock === 0 ? 'bg-rose-500' : 'bg-amber-400'}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{product.name}</p>
                        <p className="text-[11px] text-gray-400">
                          Stock: {product.stock}
                          {lastSaleText && <> · Última venta {lastSaleText}</>}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2.5 text-xs flex-shrink-0 ml-3"
                      onClick={() => router.push('/products')}
                    >
                      Surtir
                    </Button>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Actividad reciente */}
        <div>
          <h2 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Actividad reciente</h2>
          {activityLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : recentActivity.length === 0 ? (
            <Card className="p-6 flex items-center gap-3">
              <Clock className="h-4 w-4 text-gray-400" />
              <p className="text-sm text-gray-500">Sin actividad</p>
            </Card>
          ) : (
            <div className="space-y-1">
              {recentActivity.slice(0, 5).map((log) => {
                const info = actionInfo(log.action, log.entity_type, log.details || {});
                return (
                  <div key={log.id} className="flex items-start gap-2.5 py-2 px-2 rounded-lg">
                    <span className="text-sm mt-px">{info.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-900 dark:text-white">{info.label}</p>
                      {info.detail && (
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{info.detail}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 whitespace-nowrap mt-0.5">{timeAgo(log.created_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Gráfico + Resumen rápido */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Gráfico */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-900 dark:text-white">Ventas</h2>
            <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
              {CHART_PERIODS.map((period) => (
                <button
                  key={period.days}
                  onClick={() => { setChartDays(period.days); setChartLoading(true); }}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                    chartDays === period.days
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {period.label}
                </button>
              ))}
            </div>
          </div>
          <Card className="p-4">
            {chartLoading ? (
              <div className="h-24 bg-gray-100 dark:bg-gray-800 animate-pulse rounded" />
            ) : salesChartData.every(d => d.total === 0) ? (
              <div className="h-24 flex items-center justify-center text-sm text-gray-400">
                Sin ventas en este período.
              </div>
            ) : (
              <div className="h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={salesChartData} margin={{ top: 4, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="#d1d5db" axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} stroke="#d1d5db" axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Total']}
                      contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '11px' }}
                    />
                    <Bar dataKey="total" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>

        {/* Resumen rápido */}
        <div>
          <h2 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Resumen</h2>
          <Card className="p-4 space-y-3 h-full">
            <div>
              <p className="text-[11px] text-gray-400">Producto más vendido</p>
              <p className="text-xs font-semibold text-gray-900 dark:text-white mt-0.5">
                {dashboardSummary?.topProduct?.name ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400">Cliente que más compra</p>
              <p className="text-xs font-semibold text-gray-900 dark:text-white mt-0.5">
                {dashboardSummary?.topCustomer?.name ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400">Última compra registrada</p>
              <p className="text-xs font-semibold text-gray-900 dark:text-white mt-0.5">
                {dashboardSummary?.lastPurchase?.date ? timeAgo(dashboardSummary.lastPurchase.date) : 'Sin compras'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400">Proveedor más utilizado</p>
              <p className="text-xs font-semibold text-gray-900 dark:text-white mt-0.5">
                {dashboardSummary?.topSupplier?.name ?? '—'}
              </p>
            </div>
          </Card>
        </div>
      </div>

      {/* Sugerencia */}
      <div className="pb-4">
        <div className="flex items-center gap-1.5 mb-3">
          <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
          <h2 className="text-sm font-medium text-gray-900 dark:text-white">Sugerencia</h2>
        </div>
        <Card className="p-4 flex items-center justify-between gap-4">
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{SUGGESTIONS[0].text}</p>
          <Link href={SUGGESTIONS[0].href}>
            <Button size="sm" variant="outline" className="h-7 px-3 text-xs font-medium whitespace-nowrap">
              {SUGGESTIONS[0].cta}
            </Button>
          </Link>
        </Card>
      </div>
    </div>
  );
}
