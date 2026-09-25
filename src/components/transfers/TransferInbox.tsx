'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '@/lib/fetchWithTenant';
import {
  ArrowRightLeft,
  Truck,
  CheckCircle2,
  Clock,
  Package,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { StatusBadge as StatusPill } from '@/components/ui/status-badge';
import { IconAction } from '@/components/ui/icon-action';
import { formatDate } from '@/lib/utils/format';
import toast from 'react-hot-toast';
import { TRANSFER_STATUS_LABELS, type Transfer, type TransferItem } from '@/lib/types/stock-transfer';

// Fetch product names for items that don't have them
async function enrichItems(items: TransferItem[]): Promise<TransferItem[]> {
  const productIds = items.filter(i => !i.product_name).map(i => i.product_id);
  if (productIds.length === 0) return items;

  const res = await authFetch(`/api/products?ids=${productIds.join(',')}`);
  if (!res.ok) return items;

  const products: { id: string; name: string }[] = await res.json();
  const nameMap = new Map(products.map(p => [p.id, p.name]));
  return items.map(i => ({ ...i, product_name: nameMap.get(i.product_id) || i.product_id }));
}

function StatusBadge({ status }: { status: Transfer['status'] }) {
  if (status === 'pending') {
    return (
      <StatusPill size="md" tone="amber" icon={<Clock className="h-3 w-3" />}>
        {TRANSFER_STATUS_LABELS.pending}
      </StatusPill>
    );
  }
  if (status === 'in_transit') {
    return (
      <StatusPill size="md" tone="blue" icon={<Truck className="h-3 w-3 animate-[truck_1.5s_ease-in-out_infinite]" />}>
        {TRANSFER_STATUS_LABELS.in_transit}
      </StatusPill>
    );
  }
  return (
    <StatusPill size="md" tone="emerald" icon={<CheckCircle2 className="h-3 w-3" />}>
      {TRANSFER_STATUS_LABELS.received}
    </StatusPill>
  );
}

function TransferCard({
  transfer,
  currentTenantId,
  onAction,
}: {
  transfer: Transfer;
  currentTenantId: string;
  onAction: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const isSender = transfer.from_tenant_id === currentTenantId;
  const isReceiver = transfer.to_tenant_id === currentTenantId;

  const canConfirmSend = isSender && transfer.status === 'pending';
  const canConfirmReceive = isReceiver && transfer.status === 'in_transit';

  const borderColor =
    transfer.status === 'pending'
      ? 'border-amber-200 dark:border-amber-800/40'
      : transfer.status === 'in_transit'
      ? 'border-blue-200 dark:border-blue-800/40'
      : 'border-emerald-200 dark:border-emerald-800/40';

  const bgColor =
    transfer.status === 'pending'
      ? 'bg-amber-50/60 dark:bg-amber-900/10'
      : transfer.status === 'in_transit'
      ? 'bg-blue-50/60 dark:bg-blue-900/10'
      : 'bg-emerald-50/60 dark:bg-emerald-900/10';

  const handleAction = async (newStatus: 'in_transit' | 'received') => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/stock-transfers/${transfer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al actualizar');
      toast.success(
        newStatus === 'in_transit'
          ? 'Transferencia enviada — el stock fue descontado'
          : '¡Transferencia recibida! El stock fue acreditado'
      );
      onAction();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al procesar');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/stock-transfers/${transfer.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al cancelar');
      toast.success('Transferencia cancelada y eliminada');
      onAction();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al procesar');
    } finally {
      setLoading(false);
    }
  };

  const formattedDate = formatDate(transfer.created_at, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const totalUnits = transfer.items.reduce((acc, i) => acc + i.quantity, 0);

  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} overflow-hidden transition-all duration-200`}>
      {/* Card Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Route */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex flex-col items-start min-w-0">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Origen</span>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
              {transfer.from_tenant_name}
            </span>
          </div>
          <div className="flex-shrink-0 px-2">
            {transfer.status === 'in_transit' ? (
              <div className="relative">
                <ArrowRightLeft className="h-4 w-4 text-blue-500" />
                <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 bg-blue-500 rounded-full animate-ping" />
              </div>
            ) : (
              <ArrowRightLeft className="h-4 w-4 text-gray-400" />
            )}
          </div>
          <div className="flex flex-col items-start min-w-0">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Destino</span>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
              {transfer.to_tenant_name}
            </span>
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <StatusBadge status={transfer.status} />
          <div className="text-right hidden sm:block">
            <div className="text-xs text-gray-400">{formattedDate}</div>
            <div className="text-xs text-gray-500">
              {transfer.items.length} producto{transfer.items.length !== 1 ? 's' : ''} · {totalUnits} u.
            </div>
          </div>
          <IconAction
            icon={expanded ? ChevronUp : ChevronDown}
            label={expanded ? 'Contraer detalles' : 'Expandir detalles'}
            className="rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
            aria-expanded={expanded}
            onClick={() => setExpanded(e => !e)}
          />
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-inherit px-4 py-3 space-y-3">
          {/* Items list */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Productos</p>
            <div className="space-y-1">
              {transfer.items.map(item => (
                <div
                  key={item.id}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Package className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-700 dark:text-gray-300">
                      {item.product_name || item.product_id}
                    </span>
                  </div>
                  <span className="font-semibold text-gray-800 dark:text-gray-100 tabular-nums">
                    × {item.quantity}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          {transfer.notes && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Notas</p>
              <p className="text-sm text-gray-600 dark:text-gray-400 italic">{transfer.notes}</p>
            </div>
          )}

          {/* Creator */}
          <p className="text-xs text-gray-400">
            Creada por <span className="font-medium">{transfer.created_by_name}</span>
          </p>

          {/* Action buttons */}
          {(canConfirmSend || canConfirmReceive) && (
            <div className="pt-1 flex justify-end gap-2">
              {canConfirmSend && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => setShowCancelConfirm(true)}
                    className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/20 flex items-center gap-1.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    disabled={loading}
                    onClick={() => handleAction('in_transit')}
                    className="bg-amber-500 hover:bg-amber-600 text-white border-0 flex items-center gap-2"
                  >
                    {loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Truck className="h-3.5 w-3.5" />
                    )}
                    Confirmar envío
                  </Button>
                </>
              )}
              {canConfirmReceive && (
                <Button
                  size="sm"
                  disabled={loading}
                  onClick={() => handleAction('received')}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white border-0 flex items-center gap-2"
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Confirmar recepción
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={showCancelConfirm}
        onCancel={() => setShowCancelConfirm(false)}
        onConfirm={() => {
          setShowCancelConfirm(false);
          handleCancel();
        }}
        title="Cancelar Transferencia"
        message="¿Estás seguro de que deseas cancelar y eliminar esta transferencia pendiente de envío?"
        confirmLabel="Sí, cancelar"
        cancelLabel="No, mantener"
        variant="danger"
        loading={loading}
      />
    </div>
  );
}

interface TransferInboxProps {
  currentTenantId: string;
  trigger?: number;
  onAction?: () => void;
}

export function TransferInbox({ currentTenantId, trigger = 0, onAction }: TransferInboxProps) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const fetchTransfers = useCallback(async (silent = false) => {
    try {
      if (silent) setRefreshing(true);
      setError(false);

      const res = await authFetch('/api/stock-transfers?status=pending');
      const pendingData: Transfer[] = res.ok ? await res.json() : [];

      const res2 = await authFetch('/api/stock-transfers?status=in_transit');
      const transitData: Transfer[] = res2.ok ? await res2.json() : [];

      const all = [...pendingData, ...transitData];

      // Enrich items with product names
      const enriched: Transfer[] = await Promise.all(
        all.map(async t => ({
          ...t,
          items: await enrichItems(t.items),
        }))
      );

      setTransfers(enriched);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      await Promise.resolve();
      if (cancelled) return;
      fetchTransfers();
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [fetchTransfers, trigger]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (transfers.length === 0) {
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">No se pudieron cargar las transferencias activas.</p>
          <Button variant="outline" size="sm" onClick={() => fetchTransfers()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Reintentar
          </Button>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-indigo-500" />
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Transferencias activas
          </h2>
          <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
            {transfers.length}
          </span>
        </div>
        <button
          onClick={() => fetchTransfers(true)}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Actualizar"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {/* Transfer cards */}
      <div className="space-y-2">
        {transfers.map(t => (
          <TransferCard
            key={t.id}
            transfer={t}
            currentTenantId={currentTenantId}
            onAction={() => {
              fetchTransfers(true);
              if (onAction) onAction();
            }}
          />
        ))}
      </div>
    </div>
  );
}
