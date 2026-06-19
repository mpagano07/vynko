'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Loader2, TrendingUp, AlertTriangle, Package, DollarSign, BarChart3, Sparkles } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

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
  const [data, setData] = useState<{
    predictions: Prediction[];
    topProducts: Prediction[];
    needsReorder: Prediction[];
    summary: any;
    aiAnalysis: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
              <p className="text-2xl font-bold mt-1 text-gray-900 dark:text-white">${data.summary.totalSales30.toFixed(2)}</p>
              <p className="text-xs text-gray-500 mt-1">{data.summary.totalTransactions30} transacciones</p>
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
              <p className="text-xs text-gray-500 mt-1">de {data.summary.totalProducts} registrados</p>
            </div>
            <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-600">
              <Package className="h-5 w-5" />
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Necesitan reposición</p>
              <p className={`text-2xl font-bold mt-1 ${data.summary.needsReorderCount > 0 ? 'text-amber-600' : 'text-gray-900 dark:text-white'}`}>
                {data.summary.needsReorderCount}
              </p>
              <p className="text-xs text-gray-500 mt-1">Productos por debajo de proyección</p>
            </div>
            <div className={`p-2.5 rounded-lg ${data.summary.needsReorderCount > 0 ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-600' : 'bg-gray-50 dark:bg-gray-800 text-gray-400'}`}>
              <AlertTriangle className="h-5 w-5" />
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

      {/* Top Products Chart */}
      <Card className="p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-emerald-500" />
          Top 5 Productos por Demanda Diaria
        </h2>
        <div className="h-64">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* All predictions table */}
      <Card className="overflow-hidden border border-gray-100 dark:border-gray-800 p-0">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Pronóstico completo por producto</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className="py-3 px-6">Producto</th>
                <th className="py-3 px-6 text-center">Stock</th>
                <th className="py-3 px-6 text-center">Vendido (30d)</th>
                <th className="py-3 px-6 text-center">Promedio/día</th>
                <th className="py-3 px-6 text-center">Proy. mensual</th>
                <th className="py-3 px-6 text-center">Días restantes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
              {data.predictions.map((p) => (
                <tr key={p.productId} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                  <td className="py-3 px-6 font-medium text-gray-900 dark:text-gray-100">{p.productName}</td>
                  <td className="py-3 px-6 text-center">
                    <span className={`font-semibold ${p.currentStock <= p.minStock ? 'text-rose-600' : p.needsReorder ? 'text-amber-600' : 'text-gray-900 dark:text-gray-100'}`}>
                      {p.currentStock}
                    </span>
                  </td>
                  <td className="py-3 px-6 text-center text-gray-600">{p.totalSoldLast30}</td>
                  <td className="py-3 px-6 text-center text-gray-600">{p.avgDailySales}</td>
                  <td className="py-3 px-6 text-center text-gray-600">{p.projectedMonthlyDemand} u.</td>
                  <td className="py-3 px-6 text-center">
                    {p.daysUntilStockout !== null ? (
                      <span className={p.daysUntilStockout <= 7 ? 'text-rose-600 font-semibold' : 'text-gray-600'}>
                        {p.daysUntilStockout}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
