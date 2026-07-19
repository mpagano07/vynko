"use client";

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

export default function DashboardResumen({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<{
    topProduct: { name: string; qty: number } | null;
    topCustomer: { name: string; total: number } | null;
    lastPurchase: { date: string | null } | null;
    topSupplier: { name: string } | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

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
        const res = await fetch('/api/dashboard/summary', { headers });
        if (!cancelled && res.ok) setData(await res.json());
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, getHeaders]);

  return (
    <div>
      <h2 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Resumen</h2>
      <Card className="p-4 space-y-3 h-full">
        {loading ? (
          <>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-8 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            ))}
          </>
        ) : (
          <>
            <div>
              <p className="text-[11px] text-gray-400">Producto más vendido</p>
              <p className="text-xs font-semibold text-gray-900 dark:text-white mt-0.5">
                {data?.topProduct?.name ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400">Cliente que más compra</p>
              <p className="text-xs font-semibold text-gray-900 dark:text-white mt-0.5">
                {data?.topCustomer?.name ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400">Última compra registrada</p>
              <p className="text-xs font-semibold text-gray-900 dark:text-white mt-0.5">
                {data?.lastPurchase?.date ? timeAgo(data.lastPurchase.date) : 'Sin compras'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400">Proveedor más utilizado</p>
              <p className="text-xs font-semibold text-gray-900 dark:text-white mt-0.5">
                {data?.topSupplier?.name ?? '—'}
              </p>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
