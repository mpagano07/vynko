'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import {
  Loader2,
  ScrollText,
  ArrowRightLeft,
  Clock,
  Truck,
  CheckCircle2,
  Package,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { formatARS } from '@/lib/utils/currency';
import { PLAN_LIMITS } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';

interface ActivityLog {
  id: string;
  user_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, any>;
  created_at: string;
}

interface SaleDetail {
  id: string;
  total_cents: number;
  customer_name?: string;
  created_at: string;
  items: { id: string; product_name?: string; quantity: number; unit_price_cents: number; subtotal_cents: number }[];
}

interface TransferItem {
  id: string;
  product_id: string;
  product_name?: string;
  quantity: number;
}

interface Transfer {
  id: string;
  from_tenant_id: string;
  to_tenant_id: string;
  from_tenant_name: string;
  to_tenant_name: string;
  status: 'pending' | 'in_transit' | 'received';
  notes?: string;
  created_at: string;
  updated_at: string;
  received_at?: string;
  created_by_name: string;
  items: TransferItem[];
}

const ENTITY_LABELS: Record<string, string> = {
  product: 'Producto',
  sale: 'Venta',
  supplier: 'Proveedor',
  purchase_order: 'Pedido',
  category: 'Categoría',
  customer: 'Cliente',
  import: 'Importación',
  stock_transfer: 'Transferencia',
};

const ACTION_LABELS: Record<string, string> = {
  created: 'creó',
  updated: 'actualizó',
  deleted: 'eliminó',
  imported: 'importó',
  adjusted: 'ajustó',
  received: 'recibió',
  cancelled: 'canceló',
  sold: 'vendió',
  sent: 'envió',
};

const DETAIL_LABELS: Record<string, string> = {
  name: 'Nombre',
  folio: 'Folio',
  sku: 'SKU',
  products: 'Productos',
  items_count: 'Items',
  total_cents: 'Total',
  from_tenant_id: 'Sucursal origen',
  to_tenant_id: 'Sucursal destino',
  status: 'Estado',
  quantity: 'Cantidad',
  reason: 'Motivo',
};

function formatDetailValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (key === 'total_cents' && typeof value === 'number') return formatARS(value / 100);
  if (key === 'from_tenant_id' || key === 'to_tenant_id') return `#${String(value).slice(0, 8)}`;
  if (key === 'status' && typeof value === 'string') {
    const statusLabels: Record<string, string> = {
      pending: 'Pendiente',
      in_transit: 'En tránsito',
      received: 'Recibida',
    };
    return statusLabels[value] || value;
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
}

function buildDescription(log: ActivityLog): string {
  const action = ACTION_LABELS[log.action] || log.action;
  const entity = ENTITY_LABELS[log.entity_type] || log.entity_type;
  const detail = log.details?.name
    ? `"${log.details.name}"`
    : log.details?.folio
    ? `#${log.details.folio}`
    : '';
  return `${action} ${entity} ${detail}`.trim();
}

function TransferStatusBadge({ status }: { status: Transfer['status'] }) {
  if (status === 'pending')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        <Clock className="h-3 w-3" /> Pendiente
      </span>
    );
  if (status === 'in_transit')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
        <Truck className="h-3 w-3" /> En tránsito
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
      <CheckCircle2 className="h-3 w-3" /> Recibida
    </span>
  );
}

function TransfersHistoryTab() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const limit = 20;
  const [expandedTransfers, setExpandedTransfers] = useState<Set<string>>(new Set());

  const toggleTransfer = (id: string) => {
    setExpandedTransfers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/stock-transfers', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data: Transfer[] = await res.json();
        setTransfers(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  const totalPages = Math.ceil(transfers.length / limit);
  const paginated = transfers.slice(page * limit, (page + 1) * limit);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (transfers.length === 0) {
    return (
      <div className="text-center py-16">
        <ArrowRightLeft className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-gray-500">No hay transferencias registradas</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <th className="py-4 px-6 w-8"></th>
              <th className="py-4 px-6">Ruta</th>
              <th className="py-4 px-6">Productos</th>
              <th className="py-4 px-6">Estado</th>
              <th className="py-4 px-6">Creada por</th>
              <th className="py-4 px-6">Fecha envío</th>
              <th className="py-4 px-6">Fecha recepción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
            {paginated.map(t => (
              <React.Fragment key={t.id}>
              <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 cursor-pointer" onClick={() => toggleTransfer(t.id)}>
                {/* Expand toggle */}
                <td className="py-4 px-6">
                  {expandedTransfers.has(t.id) ? (
                    <ChevronUp className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  )}
                </td>
                {/* Route */}
                <td className="py-4 px-6">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800 dark:text-gray-100">
                      {t.from_tenant_name}
                    </span>
                    <ArrowRightLeft className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                    <span className="font-medium text-gray-800 dark:text-gray-100">
                      {t.to_tenant_name}
                    </span>
                  </div>
                  {t.notes && (
                    <p className="text-xs text-gray-400 italic mt-0.5 truncate max-w-[200px]">
                      {t.notes}
                    </p>
                  )}
                </td>

                {/* Items */}
                <td className="py-4 px-6">
                  <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                    <Package className="h-3.5 w-3.5" />
                    <span>
                      {t.items.length} producto{t.items.length !== 1 ? 's' : ''}
                    </span>
                    <span className="text-gray-400">·</span>
                    <span>{t.items.reduce((acc, i) => acc + i.quantity, 0)} u.</span>
                  </div>
                </td>

                {/* Status */}
                <td className="py-4 px-6">
                  <TransferStatusBadge status={t.status} />
                </td>

                {/* Creator */}
                <td className="py-4 px-6 text-gray-600 dark:text-gray-400">
                  {t.created_by_name}
                </td>

                {/* Created date */}
                <td className="py-4 px-6 text-xs text-gray-500 whitespace-nowrap">
                  {new Date(t.created_at).toLocaleDateString('es-AR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>

                {/* Received date */}
                <td className="py-4 px-6 text-xs whitespace-nowrap">
                  {t.received_at ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {new Date(t.received_at).toLocaleDateString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
              {expandedTransfers.has(t.id) && (
                <tr>
                  <td colSpan={7} className="p-0">
                    <div className="border-l-4 border-l-blue-500 bg-blue-50 dark:bg-blue-950/20 mx-4 my-2 rounded-lg overflow-hidden">
                      <div className="px-6 py-4">
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                              Transferencia #{t.id.slice(0, 8)}
                            </h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 flex items-center gap-2">
                              {t.from_tenant_name}
                              <ArrowRightLeft className="h-3.5 w-3.5 text-gray-400" />
                              {t.to_tenant_name}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {new Date(t.created_at).toLocaleDateString('es-AR', {
                                day: '2-digit',
                                month: 'long',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                          <div className="text-right">
                            <TransferStatusBadge status={t.status} />
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                              {t.items.reduce((acc, i) => acc + i.quantity, 0)} unidades
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-1">
                            <p className="text-sm">
                              <span className="text-gray-500">Creada por:</span>{' '}
                              <span className="text-gray-900 dark:text-gray-100">{t.created_by_name}</span>
                            </p>
                            <p className="text-sm">
                              <span className="text-gray-500">Cantidad de productos:</span>{' '}
                              <span className="text-gray-900 dark:text-gray-100">{t.items.length}</span>
                            </p>
                            {t.notes && (
                              <p className="text-sm">
                                <span className="text-gray-500">Notas:</span>{' '}
                                <span className="text-gray-900 dark:text-gray-100">{t.notes}</span>
                              </p>
                            )}
                          </div>
                          <div>
                            {t.items.length > 0 ? (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-xs text-gray-500 border-b border-gray-200 dark:border-gray-700">
                                    <th className="text-left py-1.5">Descripción</th>
                                    <th className="text-right py-1.5">Cant.</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {t.items.map((item) => (
                                    <tr key={item.id} className="border-t border-gray-100 dark:border-gray-800">
                                      <td className="py-1.5 text-gray-900 dark:text-gray-100">{item.product_name || 'Producto'}</td>
                                      <td className="py-1.5 text-right text-gray-600 dark:text-gray-400">{item.quantity}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <p className="text-sm text-gray-400">Sin items</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pb-2">
          <button
            disabled={page === 0}
            onClick={() => setPage(p => Math.max(0, p - 1))}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Anterior
          </button>
          <span className="text-sm text-gray-500">
            Página {page + 1} de {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}

type Tab = 'activity' | 'transfers';

export default function ActivityLogsPage() {
  const { role, tenant, tenants } = useAuth();
  const plan = tenant?.subscription_plan || 'starter';
  const maxBranches = PLAN_LIMITS[plan as PlanId]?.branches ?? 1;
  const multiBranch = maxBranches > 1 && (tenants?.length || 0) > 1;
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState('');
  const [page, setPage] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('activity');
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [saleDetails, setSaleDetails] = useState<Record<string, SaleDetail>>({});
  const limit = 50;

  const toggleLog = (log: ActivityLog) => {
    const isOpen = expandedLogs.has(log.id);
    const next = new Set(expandedLogs);
    if (isOpen) next.delete(log.id);
    else next.add(log.id);
    setExpandedLogs(next);

    if (!isOpen && log.entity_type === 'sale' && log.entity_id && !saleDetails[log.id]) {
      (async () => {
        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = {};
        if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
        const res = await fetch(`/api/sales/${log.entity_id}`, { headers });
        if (res.ok) {
          const data: SaleDetail = await res.json();
          setSaleDetails((prev) => ({ ...prev, [log.id]: data }));
        }
      })();
    }
  };

  const fetchLogs = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const headers: Record<string, string> = {};
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

    const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
    if (entityFilter) params.set('entity_type', entityFilter);

    const res = await fetch(`/api/activity-logs?${params}`, { headers });
    if (!res.ok) {
      if (res.status === 403) setLoading(false);
      return;
    }
    const json = await res.json();
    setLogs(json.data || []);
    setTotal(json.total || 0);
  }, [entityFilter, page]);

  useEffect(() => {
    setLoading(true);
    fetchLogs().finally(() => setLoading(false));
  }, [fetchLogs]);

  const totalPages = Math.ceil(total / limit);

  if (role !== 'owner' && role !== 'manager') {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">No tienes permisos para ver esta página.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <ScrollText className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
            Historial de Actividad
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Registro detallado de todas las acciones realizadas en el sistema.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={() => setActiveTab('activity')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'activity'
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <ScrollText className="h-4 w-4" />
          Actividad general
        </button>
        {multiBranch && (
          <button
            onClick={() => setActiveTab('transfers')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'transfers'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <ArrowRightLeft className="h-4 w-4" />
            Transferencias
          </button>
        )}
      </div>

      {activeTab === 'activity' ? (
        <>
          <Card className="p-4 border border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                Filtrar por:
              </label>
              <Select
                value={entityFilter}
                onChange={e => {
                  setEntityFilter(e.target.value);
                  setPage(0);
                }}
                className="max-w-xs"
              >
                <option value="">Todos</option>
                {Object.entries(ENTITY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-gray-400 ml-auto">
                {total} registro{total !== 1 ? 's' : ''}
              </span>
            </div>
          </Card>

          <Card className="overflow-hidden border border-gray-100 dark:border-gray-800 p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-16">
                <ScrollText className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-gray-500">No hay actividad registrada</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <th className="py-4 px-6 w-8"></th>
                      <th className="py-4 px-6">Usuario</th>
                      <th className="py-4 px-6">Acción</th>
                      <th className="py-4 px-6">Detalle</th>
                      <th className="py-4 px-6 text-right">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                    {logs.map(log => (
                      <React.Fragment key={log.id}>
                      <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 cursor-pointer" onClick={() => toggleLog(log)}>
                        <td className="py-4 px-6">
                          {expandedLogs.has(log.id) ? (
                            <ChevronUp className="h-4 w-4 text-gray-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-gray-400" />
                          )}
                        </td>
                        <td className="py-4 px-6">
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {log.user_name || 'Usuario'}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                            {buildDescription(log)}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-xs text-gray-500 max-w-xs truncate">
                          {log.details?.name || log.details?.folio || log.details?.sku || '—'}
                        </td>
                        <td className="py-4 px-6 text-right text-xs text-gray-500 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleDateString('es-ES', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                      {expandedLogs.has(log.id) && (
                        <tr>
                          <td colSpan={5} className="p-0">
                            <div className="border-l-4 border-l-indigo-500 bg-indigo-50 dark:bg-indigo-950/20 mx-4 my-2 rounded-lg overflow-hidden">
                              <div className="px-6 py-4">
                                <div className="flex items-start justify-between mb-4">
                                  <div>
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 capitalize">
                                      {ENTITY_LABELS[log.entity_type] || log.entity_type}
                                    </h3>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                      {buildDescription(log)}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-1">
                                      {new Date(log.created_at).toLocaleDateString('es-ES', {
                                        day: '2-digit',
                                        month: 'long',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 capitalize">
                                      {ACTION_LABELS[log.action] || log.action}
                                    </span>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                                      {log.user_name || 'Usuario'}
                                    </p>
                                  </div>
                                </div>

                                {log.entity_type === 'sale' ? (
                                  <div>
                                    {saleDetails[log.id] ? (
                                      <table className="w-full text-sm">
                                        <thead>
                                          <tr className="text-xs text-gray-500 border-b border-gray-200 dark:border-gray-700">
                                            <th className="text-left py-1.5">Descripción</th>
                                            <th className="text-right py-1.5">Cant.</th>
                                            <th className="text-right py-1.5">P. Unit.</th>
                                            <th className="text-right py-1.5">Subtotal</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {saleDetails[log.id].items.map((item) => (
                                            <tr key={item.id} className="border-t border-gray-100 dark:border-gray-800">
                                              <td className="py-1.5 text-gray-900 dark:text-gray-100">{item.product_name || 'Producto'}</td>
                                              <td className="py-1.5 text-right text-gray-600 dark:text-gray-400">{item.quantity}</td>
                                              <td className="py-1.5 text-right text-gray-600 dark:text-gray-400">{formatARS(item.unit_price_cents / 100)}</td>
                                              <td className="py-1.5 text-right font-medium text-gray-900 dark:text-gray-100">{formatARS(item.subtotal_cents / 100)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                        <tfoot>
                                          <tr className="border-t border-gray-200 dark:border-gray-700">
                                            <td colSpan={3} className="py-2 text-right text-sm text-gray-500 font-medium">Total</td>
                                            <td className="py-2 text-right text-sm font-bold text-gray-900 dark:text-gray-100">
                                              {formatARS(saleDetails[log.id].total_cents / 100)}
                                            </td>
                                          </tr>
                                        </tfoot>
                                      </table>
                                    ) : (
                                      <div className="flex items-center gap-2 text-sm text-gray-400">
                                        <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                                        Cargando detalle de la venta...
                                      </div>
                                    )}
                                  </div>
                                ) : log.details && Object.keys(log.details).length > 0 ? (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 pt-3 border-t border-gray-200 dark:border-gray-700">
                                    {Object.entries(log.details).map(([key, value]) => {
                                      const formatted = formatDetailValue(key, value);
                                      if (!formatted) return null;
                                      return (
                                        <p key={key} className="text-sm">
                                          <span className="text-gray-500">{DETAIL_LABELS[key] || key}:</span>{' '}
                                          <span className="text-gray-900 dark:text-gray-100">{formatted}</span>
                                        </p>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
                className="px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Anterior
              </button>
              <span className="text-sm text-gray-500">
                Página {page + 1} de {totalPages}
              </span>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      ) : (
        <Card className="overflow-hidden border border-gray-100 dark:border-gray-800 p-0">
          <TransfersHistoryTab />
        </Card>
      )}
    </div>
  );
}
