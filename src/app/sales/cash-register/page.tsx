'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { IconAction } from '@/components/ui/icon-action';
import toast from 'react-hot-toast';
import {
  Banknote,
  Loader2,
  Lock,
  LogOut,
  PiggyBank,
  Plus,
  Minus,
  RefreshCw,
  CheckCircle2,
  TriangleAlert,
  History,
  X,
} from 'lucide-react';
import { formatARS } from '@/lib/utils/currency';
import { authFetch } from '@/lib/fetchWithTenant';
import {
  PAYMENT_METHODS,
  getPaymentMethodLabel,
  type PaymentMethodId,
} from '@/lib/payment-methods';
import { cn } from '@/lib/utils/cn';

const CASH_METHODS = PAYMENT_METHODS;
const NON_CASH_METHODS = PAYMENT_METHODS.filter((m) => m.id !== 'cash');

/** Billetes vigentes, de mayor a menor, para la calculadora de efectivo. */
const DENOMINATIONS = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10] as const;

const BILL_FORMATTER = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

function billLabel(value: number): string {
  return `$${BILL_FORMATTER.format(value)}`;
}

function parseBillCount(raw: string): number {
  const n = parseInt(raw.replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function cashFromBills(bills: Record<number, string>): number {
  return DENOMINATIONS.reduce((sum, denomination) => sum + denomination * parseBillCount(bills[denomination] ?? ''), 0);
}

interface CashMovement {
  id: string;
  amount_cents: number;
  type: 'in' | 'out';
  reason: string;
  created_at: string;
}

interface OpenSession {
  id: string;
  opened_at: string;
  initial_fund_cents: number;
  status: string;
  expected_by_method?: Record<PaymentMethodId, number>;
  total_expected?: number;
  sales_count?: number;
  sales_total?: number;
  movements?: CashMovement[];
}

interface ClosedSession {
  id: string;
  opened_at: string;
  closed_at: string | null;
  initial_fund_cents: number;
  total_expected_cents: number;
  total_counted_cents: number;
  total_difference_cents: number;
  notes?: string | null;
}

interface CloseReport {
  initial_fund_cents: number;
  total_expected_cents: number;
  total_counted_cents: number;
  total_difference_cents: number;
  expected_by_method: Record<PaymentMethodId, number>;
  counted_by_method: Record<PaymentMethodId, number>;
  difference_by_method: Record<PaymentMethodId, number>;
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseAmount(raw: string): number {
  const v = parseFloat(String(raw).trim().replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

export default function CashRegisterPage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [openSession, setOpenSession] = useState<OpenSession | null>(null);
  const [history, setHistory] = useState<ClosedSession[]>([]);
  const [initialFund, setInitialFund] = useState('0');
  const [opening, setOpening] = useState(false);

  const [movementModal, setMovementModal] = useState<{ type: 'in' | 'out' } | null>(null);
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [movementBusy, setMovementBusy] = useState(false);

  const [arqueoOpen, setArqueoOpen] = useState(false);
  const [counted, setCounted] = useState<Record<PaymentMethodId, string>>(
    Object.fromEntries(CASH_METHODS.map((m) => [m.id, ''])) as Record<PaymentMethodId, string>
  );
  const [billCounts, setBillCounts] = useState<Record<number, string>>({});
  const [arqueoNotes, setArqueoNotes] = useState('');
  const [closing, setClosing] = useState(false);
  const [report, setReport] = useState<CloseReport | null>(null);

  const fetchState = async () => {
    const res = await authFetch('/api/cash-register');
    if (!res.ok) return;
    const data = await res.json();
    setOpenSession(data.open ?? null);
    setHistory(data.history ?? []);
  };

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        await fetchState();
      } catch (err) {
        console.error('Error loading cash register:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  const apiPost = async (url: string, body: unknown) => {
    const res = await authFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ocurrió un error');
    return data;
  };

  const openCashRegister = async () => {
    if (!openSession) setOpenSession(null);
    setOpening(true);
    try {
      await apiPost('/api/cash-register', { initial_fund: parseAmount(initialFund) });
      toast.success('Caja abierta');
      await fetchState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al abrir la caja');
    } finally {
      setOpening(false);
    }
  };

  const submitMovement = async () => {
    if (!openSession) return;
    const amount = parseAmount(movementAmount);
    const reason = movementReason.trim();
    if (amount <= 0 || !reason) {
      toast.error('Ingresá un monto mayor a 0 y un motivo');
      return;
    }
    setMovementBusy(true);
    try {
      await apiPost(`/api/cash-register/${openSession.id}/movements`, {
        type: movementModal?.type,
        amount,
        reason,
      });
      toast.success(movementModal?.type === 'in' ? 'Ingreso registrado' : 'Egreso registrado');
      setMovementModal(null);
      setMovementAmount('');
      setMovementReason('');
      await fetchState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar el movimiento');
    } finally {
      setMovementBusy(false);
    }
  };

  const submitArqueo = async () => {
    if (!openSession) return;
    const cashTotal = cashFromBills(billCounts);
    const otherTotal = NON_CASH_METHODS.reduce((sum, m) => sum + parseAmount(counted[m.id]), 0);
    const countedTotal = cashTotal + otherTotal;
    if (countedTotal <= 0) {
      toast.error('Ingresá al menos un monto contado para cerrar la caja');
      return;
    }
    const expectedTotal = (openSession.total_expected ?? 0) / 100;
    if (countedTotal < expectedTotal && !arqueoNotes.trim()) {
      toast.error('Agregá una observación para justificar el faltante de caja');
      return;
    }
    setClosing(true);
    try {
      const data = await apiPost(`/api/cash-register/${openSession.id}/close`, {
        counted: Object.fromEntries(
          CASH_METHODS.map((m) => [
            m.id,
            m.id === 'cash' ? cashTotal : parseAmount(counted[m.id]),
          ])
        ),
        notes: arqueoNotes.trim() || null,
      });
      setReport(data.report);
      setArqueoOpen(false);
      setBillCounts({});
      setArqueoNotes('');
      toast.success('Caja cerrada y arqueo registrado');
      await fetchState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cerrar la caja');
    } finally {
      setClosing(false);
    }
  };

  if (!tenantId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Banknote className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />}
        title="Caja y Arqueo"
        subtitle="Apertura, movimientos manuales y cierre de turno con arqueo ciego."
      />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        </div>
      ) : report ? (
        <ReportPanel report={report} onClose={() => setReport(null)} />
      ) : openSession ? (
        <>
          <Card className="p-5 border border-gray-100 dark:border-gray-800">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="font-bold text-gray-900 dark:text-gray-100">
                    Caja abierta
                  </p>
                  <p className="text-xs text-gray-500">Desde {fmtDateTime(openSession.opened_at)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMovementModal({ type: 'in' })}
                  className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Ingreso
                </button>
                <button
                  type="button"
                  onClick={() => setMovementModal({ type: 'out' })}
                  className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                >
                  <Minus className="h-4 w-4" />
                  Egreso
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const expected = openSession.expected_by_method;
                    // El efectivo se cuenta billete por billete; los medios
                    // digitales ya están confirmados por el sistema.
                    setCounted(
                      Object.fromEntries(
                        CASH_METHODS.map((m) => [
                          m.id,
                          m.id === 'cash' ? '' : String((expected?.[m.id] ?? 0) / 100),
                        ])
                      ) as Record<PaymentMethodId, string>
                    );
                    setBillCounts({});
                    setArqueoOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
                >
                  <Lock className="h-4 w-4" />
                  Cerrar caja
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">Fondo inicial</p>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                  {formatARS(openSession.initial_fund_cents / 100)}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">Ventas</p>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                  {openSession.sales_count ?? 0}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">Total ventas</p>
                <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                  {formatARS((openSession.sales_total ?? 0) / 100)}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">Efectivo esperado</p>
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatARS((openSession.expected_by_method?.cash ?? 0) / 100)}
                </p>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-4 border border-gray-100 dark:border-gray-800">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">
                Esperado por medio (hasta ahora)
              </h2>
              <div className="space-y-2">
                {CASH_METHODS.map((method) => (
                  <div
                    key={method.id}
                    className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0"
                  >
                    <span className="text-gray-700 dark:text-gray-300">{method.label}</span>
                    <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      {formatARS((openSession.expected_by_method?.[method.id] ?? 0) / 100)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4 border border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  Movimientos
                </h2>
                <IconAction icon={RefreshCw} label="Actualizar" tone="muted" onClick={fetchState} />
              </div>
              {(openSession.movements ?? []).length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">Sin movimientos manuales</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {(openSession.movements ?? []).map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between text-sm rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={cn(
                            'h-2 w-2 rounded-full shrink-0',
                            m.type === 'in' ? 'bg-emerald-500' : 'bg-red-500'
                          )}
                        />
                        <div className="min-w-0">
                          <p className="text-gray-800 dark:text-gray-200 truncate">{m.reason}</p>
                          <p className="text-xs text-gray-400">{fmtDateTime(m.created_at)}</p>
                        </div>
                      </div>
                      <span
                        className={cn(
                          'font-semibold tabular-nums',
                          m.type === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                        )}
                      >
                        {m.type === 'in' ? '+' : '-'}{formatARS(m.amount_cents / 100)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      ) : (
        <Card className="p-6 border border-gray-100 dark:border-gray-800 max-w-md">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
              <PiggyBank className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900 dark:text-gray-100">Abrir caja</h2>
              <p className="text-xs text-gray-500">Iniciá el turno con el fondo de caja</p>
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Fondo inicial (AR$)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={initialFund}
              onChange={(e) => setInitialFund(e.target.value)}
              aria-label="Fondo inicial"
              className="mt-1 flex h-12 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-lg font-bold tabular-nums text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            />
          </label>
          <button
            type="button"
            onClick={openCashRegister}
            disabled={opening}
            className="mt-4 w-full h-11 inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:pointer-events-none transition-colors active:scale-[0.99]"
          >
            {opening ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Abriendo...
              </>
            ) : (
              <>
                <LogOut className="h-4 w-4" />
                Abrir caja
              </>
            )}
          </button>
        </Card>
      )}

      {history.length > 0 && (
        <Card className="p-4 border border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-3">
            <History className="h-5 w-5 text-indigo-600" />
            Últimos cierres
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Abierta</th>
                  <th className="py-2.5 px-3">Cerrada</th>
                  <th className="py-2.5 px-3 text-right">Esperado</th>
                  <th className="py-2.5 px-3 text-right">Contado</th>
                  <th className="py-2.5 px-3 text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {history.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="py-2.5 px-3 text-gray-600 dark:text-gray-400">{fmtDateTime(s.opened_at)}</td>
                    <td className="py-2.5 px-3 text-gray-600 dark:text-gray-400">{fmtDateTime(s.closed_at)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-gray-900 dark:text-gray-100">{formatARS(s.total_expected_cents / 100)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-gray-900 dark:text-gray-100">{formatARS(s.total_counted_cents / 100)}</td>
                    <td
                      className={cn(
                        'py-2.5 px-3 text-right tabular-nums font-semibold',
                        s.total_difference_cents === 0
                          ? 'text-gray-400'
                          : s.total_difference_cents > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                      )}
                    >
                      {s.total_difference_cents > 0 ? '+' : ''}
                      {formatARS(s.total_difference_cents / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {movementModal && (
        <MovementModal
          type={movementModal.type}
          amount={movementAmount}
          reason={movementReason}
          busy={movementBusy}
          onAmount={setMovementAmount}
          onReason={setMovementReason}
          onClose={() => setMovementModal(null)}
          onSubmit={submitMovement}
        />
      )}

      {arqueoOpen && openSession && (
        <ArqueoModal
          counted={counted}
          notes={arqueoNotes}
          busy={closing}
          billCounts={billCounts}
          expectedTotalCents={openSession.total_expected ?? 0}
          onCounted={setCounted}
          onNotes={setArqueoNotes}
          onBillCounts={setBillCounts}
          onClose={() => setArqueoOpen(false)}
          onSubmit={submitArqueo}
        />
      )}
    </div>
  );
}

function ReportPanel({ report, onClose }: { report: CloseReport; onClose: () => void }) {
  const hasBreak = report.total_difference_cents !== 0;
  return (
    <Card className="p-5 border border-gray-100 dark:border-gray-800">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            {hasBreak ? (
              <TriangleAlert className="h-5 w-5 text-red-600 dark:text-red-400" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            )}
            Reporte de arqueo
          </h2>
          <p className="text-xs text-gray-500">
            {hasBreak
              ? 'Hay diferencias entre lo esperado y lo contado. Revisá los valores.'
              : 'La caja cerró cuadrada. Perfecto.'}
          </p>
        </div>
        <IconAction icon={X} label="Cerrar reporte" tone="muted" size="md" onClick={onClose} />
      </div>

      <div
        className={cn(
          'mb-4 rounded-xl border-2 p-4',
          report.total_difference_cents === 0
            ? 'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30'
            : report.total_difference_cents > 0
              ? 'border-sky-500/40 bg-sky-50 dark:bg-sky-950/30'
              : 'border-rose-500/50 bg-rose-50 dark:bg-rose-950/30'
        )}
      >
        <p className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">
          Diferencia total
        </p>
        <p
          className={cn(
            'mt-0.5 text-3xl font-black tabular-nums',
            report.total_difference_cents === 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : report.total_difference_cents > 0
                ? 'text-sky-600 dark:text-sky-400'
                : 'text-rose-600 dark:text-rose-400'
          )}
        >
          {report.total_difference_cents > 0 ? '+' : ''}
          {formatARS(report.total_difference_cents / 100)}
        </p>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          {report.total_difference_cents === 0
            ? 'Caja cuadrada: lo contado coincide con lo esperado.'
            : report.total_difference_cents > 0
              ? 'Sobrante de caja. Revisá si faltó registrar un egreso.'
              : 'Faltante de caja. Quedó registrada la observación del cierre.'}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <th className="py-2.5 px-3">Medio</th>
              <th className="py-2.5 px-3 text-right">Esperado</th>
              <th className="py-2.5 px-3 text-right">Contado</th>
              <th className="py-2.5 px-3 text-right">Diferencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {CASH_METHODS.map((method) => {
              const d = report.difference_by_method[method.id] ?? 0;
              return (
                <tr key={method.id}>
                  <td className="py-2.5 px-3 font-medium text-gray-900 dark:text-gray-100">
                    {getPaymentMethodLabel(method.id)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                    {formatARS((report.expected_by_method[method.id] ?? 0) / 100)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                    {formatARS((report.counted_by_method[method.id] ?? 0) / 100)}
                  </td>
                  <td
                    className={cn(
                      'py-2.5 px-3 text-right tabular-nums font-semibold',
                      d === 0
                        ? 'text-gray-400'
                        : d > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                    )}
                  >
                    {d > 0 ? '+' : ''}{formatARS(d / 100)}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-gray-200 dark:border-gray-700">
              <td className="py-3 px-3 font-bold text-gray-900 dark:text-gray-100">TOTAL</td>
              <td className="py-3 px-3 text-right font-bold tabular-nums text-gray-900 dark:text-gray-100">
                {formatARS(report.total_expected_cents / 100)}
              </td>
              <td className="py-3 px-3 text-right font-bold tabular-nums text-gray-900 dark:text-gray-100">
                {formatARS(report.total_counted_cents / 100)}
              </td>
              <td
                className={cn(
                  'py-3 px-3 text-right font-bold tabular-nums',
                  report.total_difference_cents > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : report.total_difference_cents < 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-gray-400'
                )}
              >
                {report.total_difference_cents > 0 ? '+' : ''}
                {formatARS(report.total_difference_cents / 100)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MovementModal({
  type,
  amount,
  reason,
  busy,
  onAmount,
  onReason,
  onClose,
  onSubmit,
}: {
  type: 'in' | 'out';
  amount: string;
  reason: string;
  busy: boolean;
  onAmount: (v: string) => void;
  onReason: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
return (
    <Modal
      panel
      backdropClose
      onClose={onClose}
      aria-label={type === 'in' ? 'Ingreso manual' : 'Egreso manual'}
      className="max-w-sm"
      header={
        <StatusBadge size="lg" tone={type === 'in' ? 'emerald' : 'red'}
          icon={type === 'in' ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}>
          {type === 'in' ? 'Ingreso manual' : 'Egreso manual'}
        </StatusBadge>
      }
    >
      <div className="p-5 space-y-4">
        <label className="block">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Monto</span>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => onAmount(e.target.value)}
              aria-label="Monto del movimiento"
              className="mt-1 flex h-12 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-xl font-bold tabular-nums text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Motivo</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => onReason(e.target.value)}
              aria-label="Motivo del movimiento"
              placeholder="Ej: cambio, gastos, flete..."
              className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            />
          </label>
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 h-10 rounded-md text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={busy}
              className="flex-1 h-10 inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Registrar'}
            </button>
          </div>
</div>
      </Modal>
  );
}

function ArqueoModal({
  counted,
  notes,
  busy,
  billCounts,
  expectedTotalCents,
  onCounted,
  onNotes,
  onBillCounts,
  onClose,
  onSubmit,
}: {
  counted: Record<PaymentMethodId, string>;
  notes: string;
  busy: boolean;
  billCounts: Record<number, string>;
  expectedTotalCents: number;
  onCounted: (v: Record<PaymentMethodId, string>) => void;
  onNotes: (v: string) => void;
  onBillCounts: (v: Record<number, string>) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const cashTotal = cashFromBills(billCounts);
  const digitalTotal = NON_CASH_METHODS.reduce((sum, m) => sum + parseAmount(counted[m.id]), 0);
  const countedCents = Math.round(cashTotal * 100) + Math.round(digitalTotal * 100);
  const differenceCents = countedCents - expectedTotalCents;
  const isShort = differenceCents < 0;
  const canSubmit = !busy && countedCents > 0 && (!isShort || notes.trim().length > 0);

  const setBill = (denomination: number, value: string) => {
    onBillCounts({ ...billCounts, [denomination]: value.replace(/\D/g, '').slice(0, 4) });
  };

  const adjustBill = (denomination: number, delta: number) => {
    const next = Math.max(0, parseBillCount(billCounts[denomination] ?? '') + delta);
    onBillCounts({ ...billCounts, [denomination]: next > 0 ? String(next) : '' });
  };

  return (
    <Modal
      panel
      backdropClose
      onClose={onClose}
      aria-label="Arqueo de caja"
      className="max-w-lg"
      header={
        <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg flex items-center gap-2">
          <Lock className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          Arqueo de caja
        </h3>
      }
    >
      <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Contá los billetes de efectivo. Los medios digitales ya vienen informados por el sistema.
        </p>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Efectivo por billete</h4>
            <span className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatARS(cashTotal)}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {DENOMINATIONS.map((denomination) => {
              const count = parseBillCount(billCounts[denomination] ?? '');
              return (
                <div
                  key={denomination}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40 px-2 py-1.5"
                >
                  <span className="w-14 shrink-0 text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                    {billLabel(denomination)}
                  </span>
                  <button
                    type="button"
                    onClick={() => adjustBill(denomination, -1)}
                    aria-label={`Restar un billete de ${billLabel(denomination)}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-200 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={billCounts[denomination] ?? ''}
                    onChange={(e) => setBill(denomination, e.target.value)}
                    aria-label={`Cantidad de billetes de ${billLabel(denomination)}`}
                    placeholder="0"
                    className="h-7 w-10 min-w-0 rounded-md border border-gray-300 bg-white px-1 text-center text-sm font-semibold tabular-nums text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  />
                  <button
                    type="button"
                    onClick={() => adjustBill(denomination, 1)}
                    aria-label={`Sumar un billete de ${billLabel(denomination)}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-200 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <span className="ml-auto shrink-0 text-right text-xs font-semibold tabular-nums text-gray-600 dark:text-gray-400">
                    {count > 0 ? formatARS(denomination * count) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-2.5">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Medios digitales</h4>
          {NON_CASH_METHODS.map((method) => (
            <div key={method.id} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-sm text-gray-700 dark:text-gray-300">{method.label}</span>
              <input
                type="text"
                inputMode="decimal"
                value={counted[method.id]}
                onChange={(e) => onCounted({ ...counted, [method.id]: e.target.value })}
                aria-label={`Monto contado ${method.label}`}
                placeholder="0,00"
                className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-base font-semibold tabular-nums text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
          ))}
        </section>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 space-y-1.5 text-sm">
          <div className="flex items-center justify-between text-gray-600 dark:text-gray-400">
            <span>Total contado</span>
            <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{formatARS(countedCents / 100)}</span>
          </div>
          <div className="flex items-center justify-between text-gray-600 dark:text-gray-400">
            <span>Esperado</span>
            <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{formatARS(expectedTotalCents / 100)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-1.5">
            <span className="font-semibold text-gray-900 dark:text-gray-100">Diferencia</span>
            <span
              className={cn(
                'font-bold tabular-nums',
                differenceCents === 0
                  ? 'text-gray-500 dark:text-gray-400'
                  : differenceCents > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
              )}
            >
              {differenceCents > 0 ? '+' : ''}
              {formatARS(differenceCents / 100)}
              {isShort && <span className="ml-1 text-xs">(faltante)</span>}
            </span>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide" htmlFor="arqueo-notes">
            {isShort ? 'Observación (obligatoria)' : 'Observación'}
          </label>
          <input
            id="arqueo-notes"
            type="text"
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            aria-label="Notas del arqueo"
            placeholder={isShort ? 'Justificá el faltante de caja' : 'Notas (opcional)'}
            className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
          {isShort && notes.trim().length === 0 && (
            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400">
              <TriangleAlert className="h-3.5 w-3.5" />
              Para cerrar con faltante tenés que dejar una observación.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-10 rounded-md text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="flex-1 h-10 inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Cerrando...
              </>
            ) : (
              'Confirmar arqueo'
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}