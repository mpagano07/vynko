"use client";

import { useState, useEffect, useCallback, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, Plus, ShoppingCart, Package,
  ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';
import Link from 'next/link';
import dynamicImport from 'next/dynamic';

const SalesChart = dynamicImport(() => import('./sales-chart'), { ssr: false, loading: () => <div className="h-24 bg-gray-100 dark:bg-gray-800 animate-pulse rounded" /> });
const StockAndActivity = dynamicImport(() => import('./stock-and-activity'), { ssr: false, loading: () => <div className="space-y-4"><div className="h-10 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" /><div className="h-10 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" /></div> });
const Suggestions = dynamicImport(() => import('./suggestions'), { ssr: false });
const DashboardResumen = dynamicImport(() => import('./resumen'), { ssr: false });

interface MonthlyData {
  total: number;
  saleCount: number;
  prevTotal: number;
  variationPercent: number | null;
  avgTicket: number;
}

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

export default function DashboardPage() {
  const router = useRouter();
  const { profile, tenant, loading: authLoading, isAuthenticated } = useAuth();
  const [criticalProducts, setCriticalProducts] = useState<{ id: string; name: string; stock: number; min_stock: number }[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [salesData, setSalesData] = useState<{ todayTotal: number; saleCount: number } | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyData | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated && !tenant) router.replace('/onboarding');
  }, [authLoading, isAuthenticated, tenant, router]);

  const getHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {};
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    return headers;
  }, []);

  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;

    (async () => {
      try {
        const headers = await getHeaders();
        const [salesRes, monthlyRes, criticalRes] = await Promise.all([
          fetch('/api/sales?today=true', { headers }),
          fetch('/api/sales/monthly', { headers }),
          fetch('/api/products/critical', { headers }),
        ]);

        if (cancelled) return;

        if (salesRes.ok) {
          const sales: Record<string, unknown>[] = await salesRes.json();
          startTransition(() => {
            setSalesData({
              todayTotal: sales.reduce((sum, s) => sum + ((s.total_cents as number) || 0), 0),
              saleCount: sales.length,
            });
          });
        }
        if (monthlyRes.ok) {
          const md = await monthlyRes.json();
          startTransition(() => setMonthlyData(md));
        }
        if (criticalRes.ok) {
          const cp = await criticalRes.json();
          startTransition(() => setCriticalProducts(cp));
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) startTransition(() => setProductsLoading(false));
      }
    })();
    return () => { cancelled = true; };
  }, [tenant?.id, getHeaders]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || productsLoading) {
    return (
      <div className="space-y-6 max-w-5xl">
        <div className="h-7 bg-gray-200 dark:bg-gray-800 rounded w-48 animate-pulse" />
        <div className="h-10 bg-gray-200 dark:bg-gray-800 rounded w-full animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="h-24 bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))}
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
          <Link href="/products" className="hidden sm:inline-flex">
            <Button size="sm" variant="outline" className="gap-1.5 h-8 px-3 text-sm font-medium">
              <Package className="h-3.5 w-3.5" />
              Nuevo producto
            </Button>
          </Link>
          <Link href="/providers" className="hidden sm:inline-flex">
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

        <Card className="p-4">
          <span className="text-xs text-gray-500 dark:text-gray-400">Stock crítico</span>
          <p className={`text-xl font-bold mt-2 ${criticalCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-900 dark:text-white'}`}>
            {criticalCount}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {criticalCount > 0 ? 'productos por reponer' : 'todo en orden'}
          </p>
        </Card>

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
      <StockAndActivity criticalProducts={criticalProducts} tenantId={tenant?.id ?? ''} />

      {/* Gráfico + Resumen rápido */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Card className="p-4">
            <SalesChart />
          </Card>
        </div>

        <DashboardResumen tenantId={tenant?.id ?? ''} />
      </div>

      {/* Sugerencia */}
      <Suggestions />
    </div>
  );
}
