"use client";

import { useState, useEffect, useCallback, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, Plus, ShoppingCart, Package,
  ArrowUpRight, ArrowDownRight, Minus, Building2,
} from 'lucide-react';
import { formatARS } from '@/lib/utils/currency';
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

interface PerTenantData {
  todayTotal: number;
  saleCount: number;
  total: number;
  saleCountMonth: number;
  prevTotal: number;
  variationPercent: number | null;
  avgTicket: number;
  criticalCount: number;
}

interface SalesEntry {
  total_cents: number;
}

interface CriticalProduct {
  id: string;
  name: string;
  stock: number;
  min_stock: number;
}

interface PendingOrderItem {
  product_id: string | null;
  product_name: string;
  quantity_ordered: number;
  quantity_received: number;
  quantity_pending: number;
}

interface PendingOrder {
  id: string;
  status: string;
  expected_date: string | null;
  created_at: string;
  supplier_name: string;
  tenant_name?: string;
  items: PendingOrderItem[];
}

export default function DashboardPage() {
  const router = useRouter();
  const { profile, tenant, tenants, allTenants, loading: authLoading, isAuthenticated, switchTenant } = useAuth();
  const [criticalProducts, setCriticalProducts] = useState<{ id: string; name: string; stock: number; min_stock: number }[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [salesData, setSalesData] = useState<{ todayTotal: number; saleCount: number } | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyData | null>(null);
  const [perTenant, setPerTenant] = useState<Record<string, PerTenantData>>({});

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    if (tenant || allTenants) return;

    if (tenants.length > 0) {
      // Tiene sucursales pero ninguna activa (ej: tenant guardado en
      // localStorage quedó obsoleto). Auto-seleccionar la primera en lugar de
      // mandarlo a onboarding.
      switchTenant(tenants[0].id);
    } else {
      router.replace('/onboarding');
    }
  }, [authLoading, isAuthenticated, tenant, allTenants, tenants, router, switchTenant]);

  const fetchWithTenant = useCallback(async (url: string, tenantId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {};
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    headers['x-active-tenant-id'] = tenantId;
    const res = await fetch(url, { headers });
    return res.ok ? res.json() : null;
  }, []);

  useEffect(() => {
    if (!tenant?.id && !allTenants) return;
    let cancelled = false;

    (async () => {
      try {
        if (allTenants && tenants.length > 0) {
          const results: Record<string, PerTenantData> = {};
          let allSalesTotal = 0;
          let allSalesCount = 0;
          let allMonthTotal = 0;
          let allMonthCount = 0;
          let allPrevTotal = 0;
          let allCritical: { id: string; name: string; stock: number; min_stock: number }[] = [];
          let allPending: PendingOrder[] = [];

          for (const t of tenants) {
            const [sales, monthly, critical, pending] = await Promise.all([
              fetchWithTenant(`/api/sales?today=true&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`, t.id),
              fetchWithTenant('/api/sales/monthly', t.id),
              fetchWithTenant('/api/products/critical', t.id),
              fetchWithTenant('/api/purchase-orders/pending', t.id),
            ]);

            const todayTotal = (sales as SalesEntry[] || []).reduce((sum, s) => sum + (s.total_cents || 0), 0);
            const saleCount = (sales as SalesEntry[] || []).length;
            const md = monthly as MonthlyData | null;
            const cp = (critical as CriticalProduct[] || []);
            const po = (pending as PendingOrder[] || []);

            allSalesTotal += todayTotal;
            allSalesCount += saleCount;
            allMonthTotal += md?.total || 0;
            allMonthCount += md?.saleCount || 0;
            allPrevTotal += md?.prevTotal || 0;
            allCritical = [...allCritical, ...cp];
            allPending = [...allPending, ...po.map((o) => ({ ...o, tenant_name: t.name }))];

            results[t.id] = {
              todayTotal,
              saleCount,
              total: md?.total || 0,
              saleCountMonth: md?.saleCount || 0,
              prevTotal: md?.prevTotal || 0,
              variationPercent: md?.variationPercent || null,
              avgTicket: md?.avgTicket || 0,
              criticalCount: cp.length,
            };
          }

          if (!cancelled) {
            startTransition(() => {
              setPerTenant(results);
              setSalesData({ todayTotal: allSalesTotal, saleCount: allSalesCount });
              setMonthlyData({
                total: allMonthTotal,
                saleCount: allMonthCount,
                prevTotal: allPrevTotal,
                variationPercent: allPrevTotal > 0 ? Math.round(((allMonthTotal - allPrevTotal) / allPrevTotal) * 100) : null,
                avgTicket: allMonthCount > 0 ? allMonthTotal / allMonthCount : 0,
              });
              setCriticalProducts(allCritical);
              setPendingOrders(allPending);
              setProductsLoading(false);
            });
          }
        } else if (tenant?.id) {
          const { data: { session } } = await supabase.auth.getSession();
          const headers: Record<string, string> = {};
          if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

          const [salesRes, monthlyRes, criticalRes, pendingRes] = await Promise.all([
            fetch(`/api/sales?today=true&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`, { headers }),
            fetch('/api/sales/monthly', { headers }),
            fetch('/api/products/critical', { headers }),
            fetch('/api/purchase-orders/pending', { headers }),
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
          if (pendingRes.ok) {
            const po = await pendingRes.json();
            startTransition(() => setPendingOrders(po));
          }
          if (!cancelled) startTransition(() => setProductsLoading(false));
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) startTransition(() => setProductsLoading(false));
      }
    })();
    return () => { cancelled = true; };
  }, [tenant?.id, allTenants, tenants, fetchWithTenant]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  if (!isAuthenticated && !authLoading) return null;

  const isLoading = authLoading || productsLoading;

  const criticalCount = criticalProducts.length;
  const todaySalesCount = salesData?.saleCount ?? 0;
  const hasSalesToday = todaySalesCount > 0;

  let statusMessage = '';
  let statusColor = '';
  if (isLoading) {
    statusMessage = 'Cargando estado del negocio...';
    statusColor = 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800';
  } else if (!hasSalesToday) {
    statusMessage = 'Hoy todavía no registraste ventas.';
    statusColor = 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/30';
  } else if (criticalCount > 0) {
    statusMessage = `Tenés ${criticalCount} producto${criticalCount !== 1 ? 's' : ''} con stock crítico.`;
    statusColor = 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/30';
  } else {
    statusMessage = 'Todo está funcionando correctamente.';
    statusColor = 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/30';
  }

  const tenantName = allTenants ? 'Todas las sucursales' : tenant?.name;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-h-[48px]">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Hola, {profile?.full_name?.split(' ')[0] || 'Usuario'} 👋
          </h1>
          {tenantName && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{tenantName}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/sales" prefetch={false}>
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 h-8 px-3 text-sm font-medium">
              <Plus className="h-3.5 w-3.5" />
              Nueva venta
            </Button>
          </Link>
          <Link href="/products" prefetch={false} className="hidden sm:inline-flex">
            <Button size="sm" variant="outline" className="gap-1.5 h-8 px-3 text-sm font-medium">
              <Package className="h-3.5 w-3.5" />
              Nuevo producto
            </Button>
          </Link>
          <Link href="/providers?create_po=1" prefetch={false} className="hidden sm:inline-flex">
            <Button size="sm" variant="outline" className="gap-1.5 h-8 px-3 text-sm font-medium">
              <ShoppingCart className="h-3.5 w-3.5" />
              Nueva compra
            </Button>
          </Link>
        </div>
      </div>

      <Link
        href={criticalCount > 0 ? '/products' : !hasSalesToday ? '/sales' : '#'}
        prefetch={false}
        className={`flex items-center justify-between px-4 py-2.5 rounded-lg border text-sm transition-opacity hover:opacity-80 ${statusColor}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{statusMessage.includes('rojo') ? '🔴' : statusMessage.includes('crítico') ? '🟡' : statusMessage.includes('Cargando') ? '⚪' : '🟢'}</span>
          <span className="font-medium text-gray-800 dark:text-gray-200">{statusMessage}</span>
        </div>
        {!isLoading && (criticalCount > 0 || !hasSalesToday) && (
          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 whitespace-nowrap ml-4">
            Ver detalle →
          </span>
        )}
      </Link>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 h-[104px] flex flex-col justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">Ventas hoy</span>
          </div>
          {isLoading ? (
            <div className="h-6 w-20 bg-gray-200 dark:bg-gray-800 animate-pulse rounded" />
          ) : (
            <>
              <p className="text-xl font-bold text-gray-900 dark:text-white">
                {salesData ? formatARS(salesData.todayTotal / 100) : '0.00'}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {hasSalesToday ? `${todaySalesCount} venta${todaySalesCount !== 1 ? 's' : ''}` : 'Sin ventas'}
              </p>
            </>
          )}
        </Card>

        <Card className="p-4 h-[104px] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">Ingresos del mes</span>
            {!isLoading && monthlyData?.variationPercent !== null && monthlyData?.variationPercent !== undefined && (
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
          {isLoading ? (
            <div className="h-6 w-24 bg-gray-200 dark:bg-gray-800 animate-pulse rounded" />
          ) : (
            <>
              <p className="text-xl font-bold text-gray-900 dark:text-white">
                {monthlyData ? formatARS(monthlyData.total) : '0.00'}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Ticket promedio: {monthlyData?.avgTicket != null ? formatARS(monthlyData.avgTicket) : '0.00'}
              </p>
            </>
          )}
        </Card>

        <Card className="p-4 h-[104px] flex flex-col justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">Stock crítico</span>
          {isLoading ? (
            <div className="h-6 w-12 bg-gray-200 dark:bg-gray-800 animate-pulse rounded" />
          ) : (
            <>
              <p className={`text-xl font-bold ${criticalCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-900 dark:text-white'}`}>
                {criticalCount}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {criticalCount > 0 ? 'productos por reponer' : 'todo en orden'}
              </p>
            </>
          )}
        </Card>

        <Card className="p-4 h-[104px] flex flex-col justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">Estado</span>
          {isLoading ? (
            <div className="h-6 w-16 bg-gray-200 dark:bg-gray-800 animate-pulse rounded" />
          ) : (
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white leading-snug">
                {!hasSalesToday ? 'Sin ventas hoy' : criticalCount > 0 ? 'Stock bajo' : 'Todo OK'}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {!hasSalesToday ? 'Registra tu primera venta' : criticalCount > 0 ? 'Reponé stock pronto' : 'Negocio funcionando'}
              </p>
            </div>
          )}
        </Card>
      </div>

      {allTenants && Object.keys(perTenant).length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-gray-400" />
            Desglose por sucursal
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 pr-3 text-xs font-medium text-gray-500 dark:text-gray-400">Sucursal</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400">Ventas hoy</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400">Ingresos del mes</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400">Stock crítico</th>
                  <th className="text-right py-2 pl-3 text-xs font-medium text-gray-500 dark:text-gray-400">Ticket prom.</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => {
                  const d = perTenant[t.id];
                  if (!d) return null;
                  return (
                    <tr key={t.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                      <td className="py-2.5 pr-3 font-medium text-gray-900 dark:text-white">{t.name}</td>
                      <td className="text-right py-2.5 px-3 text-gray-700 dark:text-gray-300">{formatARS(d.todayTotal / 100)}</td>
                      <td className="text-right py-2.5 px-3 text-gray-700 dark:text-gray-300">{formatARS(d.total)}</td>
                      <td className="text-right py-2.5 px-3">
                        <span className={d.criticalCount > 0 ? 'text-rose-500 font-medium' : 'text-gray-500'}>{d.criticalCount}</span>
                      </td>
                      <td className="text-right py-2.5 pl-3 text-gray-700 dark:text-gray-300">{formatARS(d.avgTicket)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <StockAndActivity criticalProducts={criticalProducts} pendingOrders={pendingOrders} tenantId={tenant?.id ?? ''} allTenants={allTenants} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Card className="p-4">
            <SalesChart />
          </Card>
        </div>

        <DashboardResumen tenantId={tenant?.id ?? ''} allTenants={allTenants} />
      </div>

      <Suggestions />
    </div>
  );
}
