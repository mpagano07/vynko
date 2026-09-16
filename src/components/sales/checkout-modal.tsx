'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  Landmark,
  CreditCard,
  Wallet,
  X,
  Loader2,
  TriangleAlert,
  CheckCircle2,
  Plus,
  Trash2,
  Printer,
  MessageCircle,
  Phone,
} from 'lucide-react';
import {
  PAYMENT_METHODS,
  type PaymentAdjustments,
  type PaymentMethodId,
} from '@/lib/payment-methods';
import { formatARS } from '@/lib/utils/currency';
import { cn } from '@/lib/utils/cn';

export interface CheckoutSplitPayment {
  method: PaymentMethodId;
  amount: number;
  received?: number;
}

export interface CheckoutPayload {
  payments: CheckoutSplitPayment[];
  primary: PaymentMethodId;
  change: number;
  printReceipt: boolean;
  whatsappPhone: string;
}

interface CheckoutModalProps {
  total: number;
  subtotal?: number;
  discount?: number;
  surcharge?: number;
  adjustments: PaymentAdjustments;
  submitting?: boolean;
  defaultPrint?: boolean;
  defaultPhone?: string;
  onClose: () => void;
  onConfirm: (payload: CheckoutPayload) => void;
}

const METHOD_ICONS: Record<PaymentMethodId, typeof Banknote> = {
  cash: Banknote,
  transfer: Landmark,
  debit: CreditCard,
  credit: CreditCard,
  mercadopago: Wallet,
};

function parseAmount(raw: string): number {
  const normalized = raw.trim().replace(/\./g, '').replace(',', '.');
  if (!normalized) return 0;
  const value = parseFloat(normalized);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function groupThousands(raw: string): string {
  if (!raw) return raw;
  const hasDecimal = raw.includes(',');
  const [intRaw = '', decRaw = ''] = hasDecimal ? raw.split(',') : [raw, ''];
  const grouped = intRaw.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return hasDecimal ? `${grouped},${decRaw.replace(/\D/g, '')}` : grouped;
}

interface PaymentLine {
  id: string;
  method: PaymentMethodId;
  allocation: string;
  received: string;
}

let lineCounter = 0;
function createLine(method: PaymentMethodId, allocation: string): PaymentLine {
  return {
    id: `line-${lineCounter++}`,
    method,
    allocation,
    received: groupThousands(String(allocation)),
  };
}

/**
 * Modal de cobro con pagos divididos y ajustes automáticos por medio de pago.
 * Se monta solo cuando la venta se está por cobrar y arranca con una sola
 * línea en efectivo con el monto precargado.
 */
export function CheckoutModal({
  total,
  subtotal,
  discount = 0,
  surcharge = 0,
  adjustments,
  submitting = false,
  defaultPrint = true,
  defaultPhone = '',
  onClose,
  onConfirm,
}: CheckoutModalProps) {
  const [lines, setLines] = useState<PaymentLine[]>(() => [
    createLine('cash', total.toFixed(2).replace('.', ',')),
  ]);
  const [activeLineId, setActiveLineId] = useState<string>(lines[0]?.id ?? '');
  const [printReceipt, setPrintReceipt] = useState<boolean>(Boolean(defaultPrint));
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState(() => (defaultPhone || '').replace(/\D/g, ''));
  const firstAmountRef = useRef<HTMLInputElement>(null);

  const totalCents = Math.round(total * 100);

  useEffect(() => {
    const t = window.setTimeout(() => {
      firstAmountRef.current?.focus();
      firstAmountRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const updateLine = (id: string, patch: Partial<PaymentLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const addLine = () => {
    const cashLine = lines.find((l) => l.method === 'cash');
    const receivedCents = cashLine ? Math.round(parseAmount(cashLine.received) * 100) : 0;
    const next = createLine('transfer', '');
    setLines((prev) => [...prev, next]);
    if (lines.length === 1 && cashLine && receivedCents >= totalCents) {
      setLines((prev) =>
        prev.map((l) => (l.id === cashLine.id ? { ...l, received: '' } : l))
      );
    }
    setActiveLineId(next.id);
    window.setTimeout(() => {
      const cashEl = document.getElementById(`received-${cashLine?.id}`);
      if (cashEl) {
        cashEl.focus();
        return;
      }
      const allocEl = document.getElementById(`allocation-${next.id}`);
      allocEl?.focus();
    }, 0);
  };

  const removeLine = (id: string) => {
    setLines((prev) => {
      const next = prev.filter((l) => l.id !== id);
      if (next.length === 0) return prev;
      if (activeLineId === id) setActiveLineId(next[next.length - 1].id);
      return next;
    });
  };

  const selectedLine = lines.find((l) => l.id === activeLineId) ?? lines[0];

  const resolved = useMemo(() => {
    const count = lines.length;
    const flexIndex = count - 1;

    const fixedAllocations = lines.map((line, idx) => {
      if (idx === flexIndex) return 0;
      const raw =
        line.method === 'cash'
          ? Math.round(parseAmount(line.received) * 100)
          : Math.round(parseAmount(line.allocation) * 100);
      if (line.method === 'cash') return Math.max(0, Math.min(raw, totalCents));
      return Math.max(0, raw);
    });

    const fixedSum = fixedAllocations.reduce((sum, v) => sum + v, 0);
    const flexAllocationCents = count === 1 ? totalCents : Math.max(0, totalCents - fixedSum);

    const rows = lines.map((line, idx) => {
      const allocationCents = idx === flexIndex ? flexAllocationCents : fixedAllocations[idx];
      const adjustmentPct = adjustments[line.method] ?? 0;
      const netCents = Math.round((allocationCents * (100 + adjustmentPct)) / 100);
      const receivedCents =
        line.method === 'cash' ? Math.round(parseAmount(line.received) * 100) : netCents;
      const changeCents = line.method === 'cash' ? Math.max(0, receivedCents - netCents) : 0;
      const shortReceived = line.method === 'cash' && receivedCents < netCents;
      return {
        line,
        idx,
        isFlex: idx === flexIndex,
        allocationCents,
        netCents,
        receivedCents,
        changeCents,
        shortReceived,
      };
    });

    const allocationSum = rows.reduce((sum, r) => sum + r.allocationCents, 0);
    const covered = allocationSum >= totalCents - 1 && allocationSum <= totalCents + 1;
    const collectedCents = rows.reduce((sum, r) => sum + r.netCents, 0);
    const totalChangeCents = rows.reduce((sum, r) => sum + r.changeCents, 0);
    return { rows, allocationSum, covered, collectedCents, totalChangeCents, flexIndex };
  }, [lines, adjustments, totalCents]);

  const hasAdjustments = useMemo(
    () => PAYMENT_METHODS.some((m) => adjustments[m.id] !== 0),
    [adjustments]
  );

  const canConfirm = resolved.covered && resolved.rows.every((r) => (r.isFlex || r.allocationCents > 0) && !r.shortReceived) && (!whatsappEnabled || whatsappPhone.trim().length > 0) && !submitting;

  const confirmPayment = useCallback(() => {
    const payments = resolved.rows
      .filter((r) => r.allocationCents > 0)
      .map((r) => ({
        method: r.line.method,
        amount: r.allocationCents / 100,
        ...(r.line.method === 'cash' ? { received: r.receivedCents / 100 } : {}),
      }));
    const primary =
      [...resolved.rows].sort((a, b) => b.allocationCents - a.allocationCents)[0]?.line
        .method ?? 'cash';
    onConfirm({
      payments,
      primary,
      change: resolved.totalChangeCents / 100,
      printReceipt,
      whatsappPhone: whatsappEnabled ? whatsappPhone.trim() : '',
    });
  }, [resolved, onConfirm, printReceipt, whatsappEnabled, whatsappPhone]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = Boolean(
        target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      );

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Enter') {
        if (canConfirm) {
          e.preventDefault();
          confirmPayment();
        }
        return;
      }

      if (isTyping || !selectedLine) return;

      const method = PAYMENT_METHODS.find(
        (m) => m.hotkey.toLowerCase() === e.key.toLowerCase()
      );
      if (method) {
        e.preventDefault();
        const id = selectedLine.id;
        updateLine(id, { method: method.id });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lines, selectedLine, canConfirm, onClose, confirmPayment]);

  const showBreakdown = subtotal !== undefined && (discount > 0 || surcharge > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cobrar venta"
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            Cobrar venta
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          <div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                  Total de la venta
                </p>
                <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                  {formatARS(total)}
                </p>
              </div>
              {hasAdjustments && (
                <p className="text-xs text-gray-500 dark:text-gray-400 text-right">
                  Se cobra en total{' '}
                  <span className="font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                    {formatARS(resolved.collectedCents / 100)}
                  </span>
                  <br />
                  (descuentos/recargos automáticos)
                </p>
              )}
            </div>
            {showBreakdown && (
              <div className="mt-1.5 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                <p className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatARS(subtotal)}</span>
                </p>
                {discount > 0 && (
                  <p className="flex justify-between text-emerald-600 dark:text-emerald-400">
                    <span>Descuento ({-Math.round((discount / subtotal) * 100)}%)</span>
                    <span className="tabular-nums">-{formatARS(discount)}</span>
                  </p>
                )}
                {surcharge > 0 && (
                  <p className="flex justify-between text-amber-600 dark:text-amber-400">
                    <span>Recargo (+{Math.round((surcharge / subtotal) * 100)}%)</span>
                    <span className="tabular-nums">+{formatARS(surcharge)}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Medios de pago
              </p>
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Dividir pago
              </button>
            </div>

            {resolved.rows.map(({ line, isFlex, allocationCents, netCents, changeCents, shortReceived }) => {
              const pct = adjustments[line.method] ?? 0;
              const isCash = line.method === 'cash';
              const split = lines.length > 1;
              return (
                <div
                  key={line.id}
                  className="rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3"
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {PAYMENT_METHODS.map((method) => {
                      const Icon = METHOD_ICONS[method.id];
                      const active = line.method === method.id;
                      return (
                        <button
                          key={method.id}
                          type="button"
                          onClick={() => updateLine(line.id, { method: method.id })}
                          aria-pressed={active}
                          title={`${method.label} (${method.hotkey})`}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-all',
                            active
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-500'
                              : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-indigo-300 hover:bg-white dark:hover:bg-gray-800'
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {method.label}
                          {pct !== 0 && (
                            <span
                              className={cn(
                                'px-1 rounded font-mono text-[10px]',
                                pct < 0
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                              )}
                            >
                              {pct > 0 ? '+' : ''}
                              {pct}%
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {split && (
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        className="ml-auto p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        aria-label="Quitar medio de pago"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <div>
                      {isCash ? (
                        <>
                          <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                            {split ? (
                              <>
                                Cubre del total:{' '}
                                <span className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                                  {formatARS(allocationCents / 100)}
                                </span>
                              </>
                            ) : (
                              'Pago total en efectivo'
                            )}
                          </p>
                          {pct !== 0 && (
                            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                              Ajuste {pct > 0 ? '+' : ''}
                              {pct}% ={' '}
                              <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                                {formatARS(netCents / 100)}
                              </span>
                            </p>
                          )}
                        </>
                      ) : isFlex ? (
                        <>
                          <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                            Monto a repartir
                          </label>
                          <div className="mt-1 flex h-10 items-center rounded-md border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/60 px-3 text-base font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                            {formatARS(allocationCents / 100)}
                          </div>
                          <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                            Se carga automáticamente el resto
                          </p>
                        </>
                      ) : (
                        <>
                          <label
                            htmlFor={`allocation-${line.id}`}
                            className="text-[11px] font-medium text-gray-500 dark:text-gray-400"
                          >
                            Monto a repartir
                          </label>
                          <input
                            id={`allocation-${line.id}`}
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            value={line.allocation}
                            onChange={(e) => updateLine(line.id, { allocation: e.target.value })}
                            onFocus={() => setActiveLineId(line.id)}
                            aria-label={`Monto del medio ${PAYMENT_METHODS.find((m) => m.id === line.method)?.label}`}
                            className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-base font-semibold tabular-nums text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                          />
                          {pct !== 0 && (
                            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                              Ajuste {pct > 0 ? '+' : ''}
                              {pct}% ={' '}
                              <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                                {formatARS(netCents / 100)}
                              </span>
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    {isCash ? (
                      <div>
                        <label
                          htmlFor={`received-${line.id}`}
                          className="text-[11px] font-medium text-gray-500 dark:text-gray-400"
                        >
                          Recibido
                        </label>
                        <input
                          id={`received-${line.id}`}
                          ref={firstAmountRef}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={line.received}
                          onChange={(e) => updateLine(line.id, { received: groupThousands(e.target.value) })}
                          onFocus={() => setActiveLineId(line.id)}
                          aria-label="Monto abonado"
                          className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-base font-semibold tabular-nums text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                        />
                        {shortReceived ? (
                          <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
                            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                            Faltan {formatARS(Math.max(0, netCents - Math.round(parseAmount(line.received) * 100)) / 100)}
                          </p>
                        ) : (
                          changeCents > 0 && (
                            <p className="mt-1 flex items-center gap-1 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="h-4 w-4 shrink-0" />
                              Vuelto: {formatARS(changeCents / 100)}
                            </p>
                          )
                        )}
                      </div>
                    ) : (
                      <div className="flex items-end gap-1 pb-1">
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          Se cobrará{' '}
                          <span className="font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                            {formatARS(netCents / 100)}
                          </span>
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {!resolved.covered && (
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-600 dark:text-amber-400">
                <TriangleAlert className="h-4 w-4 shrink-0" />
                {resolved.allocationSum > totalCents + 1
                  ? `El reparto supera el total en ${formatARS((resolved.allocationSum - totalCents) / 100)}`
                  : `Falta repartir ${formatARS(Math.max(0, total - resolved.allocationSum / 100))}`}
              </p>
            )}
          </div>

          <div className="pt-1 space-y-2">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={printReceipt}
                  onChange={(e) => setPrintReceipt(e.target.checked)}
                  aria-label="Imprimir ticket al finalizar"
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
                  <Printer className="h-4 w-4 text-indigo-500" />
                  Imprimir
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={whatsappEnabled}
                  onChange={(e) => setWhatsappEnabled(e.target.checked)}
                  aria-label="Enviar ticket por WhatsApp"
                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
                  <MessageCircle className="h-4 w-4 text-emerald-500" />
                  WhatsApp
                </span>
              </label>
            </div>

            {whatsappEnabled && (
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-2.5">
                <label
                  htmlFor="whatsapp-phone"
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300"
                >
                  <Phone className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Número de WhatsApp
                </label>
                <input
                  id="whatsapp-phone"
                  type="tel"
                  autoComplete="off"
                  inputMode="numeric"
                  value={whatsappPhone}
                  onChange={(e) => setWhatsappPhone(e.target.value.replace(/\D/g, ''))}
                  placeholder="1122223333"
                  aria-label="Número de WhatsApp"
                  className="mt-1.5 flex h-10 w-full rounded-md border border-emerald-300 bg-white px-3 py-2 text-base font-semibold tabular-nums text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                />
                <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  Solo números: código de área + teléfono todo junto (ej: 1122223333).
                </p>
              </div>
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
              onClick={confirmPayment}
              disabled={!canConfirm}
              className="flex-1 h-10 inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:pointer-events-none transition-colors active:scale-[0.99]"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  Confirmar pago
                  <kbd className="px-1.5 py-0.5 rounded bg-indigo-700/80 text-xs font-mono">Enter</kbd>
                </>
              )}
            </button>
          </div>

          {resolved.totalChangeCents > 0 && canConfirm && (
            <p className="text-center text-lg font-bold text-emerald-600 dark:text-emerald-400">
              Vuelto total: {formatARS(resolved.totalChangeCents / 100)}
            </p>
          )}

          <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
            Atajos: <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 font-mono">E</kbd> Efectivo ·{' '}
            <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 font-mono">T</kbd> Transferencia ·{' '}
            <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 font-mono">D</kbd> Débito ·{' '}
            <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 font-mono">C</kbd> Crédito ·{' '}
            <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 font-mono">M</kbd> Mercado Pago
          </p>
        </div>
      </div>
    </div>
  );
}