"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Clock } from 'lucide-react';

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

interface ActivityLog {
  id: string;
  action: string;
  entity_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

interface CriticalProduct {
  id: string;
  name: string;
  stock: number;
  min_stock: number;
}

export default function StockAndActivity({
  criticalProducts,
  tenantId,
}: {
  criticalProducts: CriticalProduct[];
  tenantId: string;
}) {
  const router = useRouter();
  const [recentActivity, setRecentActivity] = useState<ActivityLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [stockAnalysis, setStockAnalysis] = useState<{ id: string; lastSale: string | null }[]>([]);

  const criticalCount = criticalProducts.length;

  const getHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {};
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    return headers;
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;

    (async () => {
      try {
        const headers = await getHeaders();
        const [activityRes, stockRes] = await Promise.all([
          fetch('/api/activity-logs?limit=5', { headers }),
          fetch('/api/products/stock-analysis', { headers }),
        ]);

        if (cancelled) return;

        if (activityRes.ok) {
          const d = await activityRes.json();
          setRecentActivity(d.data || []);
        }
        if (stockRes.ok) setStockAnalysis(await stockRes.json());
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, getHeaders]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-gray-900 dark:text-white">Alertas de stock</h2>
          {criticalCount > 5 && (
            <span className="text-xs text-indigo-600 dark:text-indigo-400">Ver todas →</span>
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
  );
}
