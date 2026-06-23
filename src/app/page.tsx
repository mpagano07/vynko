"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useProducts } from '@/lib/hooks/useProducts';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Package, AlertOctagon, TrendingUp, Users, ArrowRight, CheckCircle2, BarChart3 } from 'lucide-react';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export default function DashboardPage() {
  const router = useRouter();
  const { profile, tenant, loading: authLoading, isAuthenticated } = useAuth();
  const { products, isLoading: productsLoading } = useProducts(tenant?.id);

  useEffect(() => {
    if (!authLoading && isAuthenticated && !tenant) {
      router.replace('/onboarding');
    }
  }, [authLoading, isAuthenticated, tenant, router]);
  const [salesData, setSalesData] = useState<{ todayTotal: number; saleCount: number } | null>(null);
  const [salesLoading, setSalesLoading] = useState(true);
  const [salesChartData, setSalesChartData] = useState<{ date: string; day: string; total: number }[]>([]);
  const [chartLoading, setChartLoading] = useState(true);

  useEffect(() => {
    if (!tenant?.id) return;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = {};
        if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

        const [salesRes, summaryRes] = await Promise.all([
          fetch('/api/sales', { headers }),
          fetch('/api/sales/summary', { headers }),
        ]);

        if (salesRes.ok) {
          const sales: Record<string, unknown>[] = await salesRes.json();
          const today = new Date();
          const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
          const todaySales = sales.filter(s => (s.created_at as string) >= todayStart);
          const todayTotal = todaySales.reduce((sum, s) => sum + ((s.total_cents as number) || 0), 0);
          setSalesData({ todayTotal, saleCount: todaySales.length });
        }

        if (summaryRes.ok) {
          const summary = await summaryRes.json();
          setSalesChartData(summary);
        }
      } catch (err) {
        console.error('Error fetching sales:', err);
      } finally {
        setSalesLoading(false);
        setChartLoading(false);
      }
    })();
  }, [tenant?.id]);

  useEffect(() => {
    // Redirect to login if not authenticated
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || productsLoading || salesLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-1/3 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="h-28 bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))}
        </div>
        <Card className="h-64 bg-gray-100 dark:bg-gray-800 animate-pulse" />
        <Card className="h-48 bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const totalProducts = products?.length || 0;
  const criticalProducts = products?.filter(p => (p.stock ?? 0) <= (p.min_stock ?? 0)) || [];
  const criticalCount = criticalProducts.length;

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight">
            ¡Hola, {profile?.full_name || 'Usuario'}!
          </h1>
          {tenant && (
            <div className="flex items-center gap-2 mt-2">
              <div className="w-7 h-7 rounded-md bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{(tenant.name || 'T')[0].toUpperCase()}</span>
              </div>
              <p className="text-base font-semibold text-gray-700 dark:text-gray-300">
                {tenant.name}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-6 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Ventas hoy</h3>
            <p className="text-3xl font-extrabold mt-2 text-gray-900 dark:text-white">
              ${salesData ? (salesData.todayTotal / 100).toFixed(2) : '0.00'}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              {salesData ? `${salesData.saleCount} venta(s)` : 'Sin ventas'}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="h-6 w-6" />
          </div>
        </Card>

        <Card className="p-6 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Stock crítico</h3>
            <p className={`text-3xl font-extrabold mt-2 ${criticalCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-900 dark:text-white'}`}>
              {criticalCount}
            </p>
            <p className="text-xs text-gray-500 mt-2">Requieren reposición</p>
          </div>
          <div className={`p-3 rounded-lg ${criticalCount > 0 ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400' : 'bg-gray-50 dark:bg-gray-800 text-gray-400'}`}>
            <AlertOctagon className="h-6 w-6" />
          </div>
        </Card>

        <Card className="p-6 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Total productos</h3>
            <p className="text-3xl font-extrabold mt-2 text-gray-900 dark:text-white">{totalProducts}</p>
            <p className="text-xs text-gray-500 mt-2">Variantes registradas</p>
          </div>
          <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400">
            <Package className="h-6 w-6" />
          </div>
        </Card>

        <Card className="p-6 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Colaboradores</h3>
            <p className="text-3xl font-extrabold mt-2 text-gray-900 dark:text-white">1</p>
            <p className="text-xs text-gray-500 mt-2">Usuarios activos</p>
          </div>
          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400">
            <Users className="h-6 w-6" />
          </div>
        </Card>
      </div>

      {/* Sales Chart */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-indigo-500" />
            Ventas de los últimos 7 días
          </h2>
        </div>
        {chartLoading ? (
          <div className="h-52 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-lg" />
        ) : salesChartData.length === 0 || salesChartData.every(d => d.total === 0) ? (
          <div className="flex flex-col items-center justify-center py-12 text-center bg-gray-50/50 dark:bg-gray-900/50 rounded-lg border border-dashed border-gray-200 dark:border-gray-800">
            <BarChart3 className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Sin ventas aún</p>
            <p className="text-xs text-gray-500 mt-0.5">Las ventas registradas aparecerán aquí.</p>
          </div>
        ) : (
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
                <Tooltip
                  formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Total']}
                  labelFormatter={(label, payload) => {
                    const item = (payload as any[])?.[0]?.payload;
                    return item?.date || label;
                  }}
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="total" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Main Grid Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Critical Stock items */}
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <AlertOctagon className="h-5 w-5 text-rose-500" />
              Alertas de Stock Mínimo
            </h2>
            <Link href="/products" className="text-xs text-indigo-600 hover:text-indigo-500 font-semibold flex items-center gap-0.5">
              Ver todo <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {criticalCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center bg-gray-50/50 dark:bg-gray-900/50 rounded-lg border border-dashed border-gray-200 dark:border-gray-800">
              <CheckCircle2 className="h-10 w-10 text-green-500 mb-2" />
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Todo en orden</p>
              <p className="text-xs text-gray-500 mt-0.5">No tienes productos por debajo del stock mínimo.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {criticalProducts.slice(0, 5).map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between p-3.5 bg-rose-50/30 dark:bg-rose-950/10 rounded-lg border border-rose-100/50 dark:border-rose-950/30"
                >
                  <div>
                    <span className="font-semibold text-sm text-gray-900 dark:text-white">{product.name}</span>
                    <div className="text-xs text-gray-500 mt-0.5">SKU: {product.sku || '—'}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">Stock: {product.stock}</div>
                      <div className="text-[10px] text-gray-400">Min. Requerido: {product.min_stock}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push('/products')}
                      className="h-8 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-900/30 dark:text-rose-400 dark:hover:bg-rose-950/30"
                    >
                      Surtir
                    </Button>
                  </div>
                </div>
              ))}
              {criticalCount > 5 && (
                <p className="text-xs text-center text-gray-500 pt-2">
                  Y otros {criticalCount - 5} productos más en estado crítico.
                </p>
              )}
            </div>
          )}
        </Card>

        {/* Right Column - Checklist Actions */}
        <Card className="p-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Primeros Pasos</h2>
          <div className="space-y-4">
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 flex items-center justify-center font-bold text-xs">✓</span>
              <div>
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Crear Empresa</h4>
                <p className="text-xs text-gray-500 mt-0.5">Completaste el onboarding de tu negocio.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                totalProducts > 0 
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
                  : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
              }`}>
                {totalProducts > 0 ? '✓' : '2'}
              </span>
              <div>
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Registrar Productos</h4>
                <p className="text-xs text-gray-500 mt-0.5">Agrega tus productos al catálogo de inventario.</p>
                {totalProducts === 0 && (
                  <Button
                    size="sm"
                    className="mt-2 text-xs h-7 px-3"
                    onClick={() => router.push('/products')}
                  >
                    Agregar producto
                  </Button>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                salesData && salesData.saleCount > 0
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
              }`}>
                {salesData && salesData.saleCount > 0 ? '✓' : '3'}
              </span>
              <div>
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Registrar tu primera venta</h4>
                <p className="text-xs text-gray-500 mt-0.5">Comienza a operar vendiendo tus productos registrados.</p>
                {(!salesData || salesData.saleCount === 0) && (
                  <Button
                    size="sm"
                    className="mt-2 text-xs h-7 px-3"
                    onClick={() => router.push('/sales')}
                  >
                    Registrar venta
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

