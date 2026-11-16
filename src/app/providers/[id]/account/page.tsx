'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { authFetch } from '@/lib/fetchWithTenant';
import { formatARS } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/format';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import { LoadingState } from '@/components/ui/loading-state';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';
import { ArrowLeft, Wallet, Receipt, Ban } from 'lucide-react';

type PayableStatus = 'pending' | 'partial' | 'paid' | 'overdue';

const STATUS_LABEL: Record<PayableStatus, string> = {
  pending: 'Pendiente',
  partial: 'Parcial',
  paid: 'Pagado',
  overdue: 'Vencido',
};
const STATUS_TONE: Record<PayableStatus, StatusTone> = {
  pending: 'amber',
  partial: 'blue',
  paid: 'green',
  overdue: 'red',
};

interface Payable {
  document_id: string;
  purchase_order_id: string;
  document_number: number | null;
  document_date: string | null;
  supplier_name: string | null;
  debt_cents: number;
  paid_cents: number;
  balance_cents: number;
  due_date: string | null;
  status: PayableStatus;
}

interface Payment {
  id: string;
  amount_cents: number;
  payment_date: string;
  method: string;
  reference?: string | null;
  notes?: string | null;
  status: 'posted' | 'voided';
  void_reason?: string | null;
  created_at?: string;
}

interface AccountData {
  supplier: { id: string; name: string; payment_term_days: number | null };
  cutoff_date: string | null;
  summary: { debt_cents: number; paid_cents: number; balance_cents: number; overdue_count: number; open_count: number };
  payables: Payable[];
  payments: Payment[];
}

export default function SupplierAccountPage() {
  const params = useParams<{ id: string }>();
  const supplierId = params?.id as string;
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [payOpen, setPayOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('transfer');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [allocs, setAllocs] = useState<Record<string, string>>({});

  const [voidTarget, setVoidTarget] = useState<Payment | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [cutoffInput, setCutoffInput] = useState<string>('');
  const [savingCutoff, setSavingCutoff] = useState(false);

  const load = React.useCallback(async () => {
    if (!supplierId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/suppliers/${supplierId}/account`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Error al cargar la cuenta corriente');
      }
      const json = await res.json();
      setData(json);
      setCutoffInput(json.cutoff_date || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, [supplierId]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const openPayables = useMemo(() => (data?.payables ?? []).filter((p) => p.balance_cents > 0), [data]);
  const allocSumCents = useMemo(() => {
    return openPayables.reduce((sum, p) => {
      const v = Math.round(Number(allocs[p.document_id] || 0) * 100);
      return sum + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);
  }, [allocs, openPayables]);
  const amountCents = Math.round(Number(amount || 0) * 100);

  const openPay = () => {
    const initial: Record<string, string> = {};
    openPayables.forEach((p) => (initial[p.document_id] = ''));
    setAllocs(initial);
    setAmount('');
    setReference('');
    setNotes('');
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPayOpen(true);
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      toast.error('Ingresá un monto válido');
      return;
    }
    const allocations = openPayables
      .map((p) => ({ purchase_order_id: p.purchase_order_id, document_id: p.document_id, amount_cents: Math.round(Number(allocs[p.document_id] || 0) * 100) }))
      .filter((a) => a.amount_cents > 0);
    if (allocations.length === 0) {
      toast.error('Imputá el pago a al menos un documento');
      return;
    }
    const sum = allocations.reduce((s, a) => s + a.amount_cents, 0);
    if (sum !== amountCents) {
      toast.error('La suma de las imputaciones debe ser igual al monto del pago');
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/suppliers/${supplierId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_cents: amountCents, payment_date: paymentDate, method, reference: reference || null, notes: notes || null, allocations }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'No se pudo registrar el pago');
      }
      toast.success('Pago registrado');
      setPayOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmVoid = async () => {
    if (!voidTarget) return;
    if (!voidReason.trim()) { toast.error('Ingresá el motivo'); return; }
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/supplier-payments/${voidTarget.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: voidReason }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'No se pudo anular el pago');
      }
      toast.success('Pago anulado');
      setVoidTarget(null);
      setVoidReason('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setSubmitting(false);
    }
  };

  const saveCutoff = async () => {
    setSavingCutoff(true);
    try {
      const res = await authFetch('/api/settings/supplier-account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutoff_date: cutoffInput || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'No se pudo guardar la fecha de corte');
      toast.success('Fecha de corte actualizada');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setSavingCutoff(false);
    }
  };

  const autoFillAllocations = () => {
    let remaining = Math.max(0, Math.round(Number(amount || 0) * 100));
    const next: Record<string, string> = {};
    for (const p of openPayables) {
      if (remaining <= 0) { next[p.document_id] = ''; continue; }
      const take = Math.min(remaining, p.balance_cents);
      next[p.document_id] = (take / 100).toFixed(2);
      remaining -= take;
    }
    setAllocs(next);
  };

  if (loading) return <LoadingState />;
  if (error || !data) return <div className="p-6 text-red-600">{error || 'Error'}</div>;

  const { supplier, cutoff_date, summary, payables, payments } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/providers" className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"><ArrowLeft className="h-5 w-5" /></Link>
        <PageHeader icon={<Wallet className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />} title={`Cuenta corriente: ${supplier.name}`} subtitle={cutoff_date ? `Incluye recepciones desde ${formatDate(cutoff_date)}.` : 'Sin fecha de corte configurada: no se incluyen deudas históricas hasta definir un corte.'} />
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-2">Fecha de corte de cuenta corriente</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Solo se incluyen recepciones (remitos de ingreso) desde esta fecha. Dejar vac?o excluye todo lo hist?rico hasta configurar un corte (4B).</p>
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-end">
          <div>
            <label className="block text-xs font-medium mb-1">Fecha de corte</label>
            <Input type="date" value={cutoffInput} onChange={(e) => setCutoffInput(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCutoffInput('')} type="button">Quitar corte</Button>
            <Button onClick={saveCutoff} disabled={savingCutoff} type="button">{savingCutoff ? 'Guardando...' : 'Guardar corte'}</Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4"><p className="text-sm text-gray-500">Saldo pendiente</p><p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatARS(summary.balance_cents / 100)}</p></Card>
        <Card className="p-4"><p className="text-sm text-gray-500">Total adeudado</p><p className="text-xl font-semibold text-gray-900 dark:text-gray-100">{formatARS(summary.debt_cents / 100)}</p></Card>
        <Card className="p-4"><p className="text-sm text-gray-500">Total pagado</p><p className="text-xl font-semibold text-gray-900 dark:text-gray-100">{formatARS(summary.paid_cents / 100)}</p></Card>
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Receipt className="h-5 w-5" /> Documentos adeudados (recepciones)</h2>
          <Button onClick={openPay} disabled={openPayables.length === 0}>Registrar pago</Button>
        </div>
        {payables.length === 0 ? (
          <EmptyState icon={Receipt} title="Sin documentos en cuenta corriente" description="Las recepciones dentro de la fecha de corte aparecerán aquí." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700"><th className="py-2">Fecha</th><th>Remito</th><th>OC</th><th>Vence</th><th className="text-right">Deuda</th><th className="text-right">Pagado</th><th className="text-right">Saldo</th><th>Estado</th></tr></thead>
              <tbody>
                {payables.map((p) => (
                  <tr key={p.document_id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2">{formatDate(p.document_date || '')}</td>
                    <td>#{p.document_number ?? '-'}</td>
                    <td className="font-mono text-xs">{p.purchase_order_id.slice(0, 8)}</td>
                    <td>{p.due_date ? formatDate(p.due_date) : '-'}</td>
                    <td className="text-right">{formatARS(p.debt_cents / 100)}</td>
                    <td className="text-right">{formatARS(p.paid_cents / 100)}</td>
                    <td className="text-right font-medium">{formatARS(p.balance_cents / 100)}</td>
                    <td><StatusBadge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-4">Pagos</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-gray-500">No hay pagos registrados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700"><th className="py-2">Fecha</th><th>Monto</th><th>Medio</th><th>Referencia</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2">{formatDate(p.payment_date)}</td>
                    <td>{formatARS(p.amount_cents / 100)}</td>
                    <td>{p.method}</td>
                    <td>{p.reference || '-'}</td>
                    <td>{p.status === 'voided' ? <StatusBadge tone="red">Anulado</StatusBadge> : <StatusBadge tone="green">Registrado</StatusBadge>}</td>
                    <td className="text-right">
                      {p.status === 'posted' && (
                        <Button variant="outline" size="sm" onClick={() => { setVoidTarget(p); setVoidReason(''); }} className="gap-1"><Ban className="h-3.5 w-3.5" /> Anular</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {payOpen && (
        <Modal onClose={() => setPayOpen(false)} className="max-w-2xl" title="Registrar pago">
          <form onSubmit={submitPayment} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><label className="block text-sm font-medium mb-1">Monto</label><Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
              <div><label className="block text-sm font-medium mb-1">Fecha</label><Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required /></div>
              <div><label className="block text-sm font-medium mb-1">Medio</label>
                <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="transfer">Transferencia</option>
                  <option value="cash">Efectivo</option>
                  <option value="check">Cheque</option>
                  <option value="other">Otro</option>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium mb-1">Referencia</label><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° comprobante / transferencia" /></div>
              <div><label className="block text-sm font-medium mb-1">Notas</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Imputar a documentos (saldo pendiente)</p>
                <Button type="button" variant="outline" size="sm" onClick={autoFillAllocations}>Autocompletar</Button>
              </div>
              <div className="space-y-2 max-h-56 overflow-auto border border-gray-200 dark:border-gray-700 rounded-md p-2">
                {openPayables.map((p) => (
                  <div key={p.document_id} className="flex items-center gap-3 text-sm">
                    <div className="flex-1">
                      <div>Remito #{p.document_number ?? '-'} · OC {p.purchase_order_id.slice(0,8)} · vence {p.due_date ? formatDate(p.due_date) : '-'}</div>
                      <div className="text-xs text-gray-500">Saldo: {formatARS(p.balance_cents / 100)}</div>
                    </div>
                    <Input className="w-32" type="number" min={0} step="0.01" value={allocs[p.document_id] ?? ''} onChange={(e) => setAllocs({ ...allocs, [p.document_id]: e.target.value })} />
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">Imputado: {formatARS(allocSumCents / 100)} / Pago: {formatARS((amountCents || 0) / 100)}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={submitting}>{submitting ? 'Guardando...' : 'Registrar pago'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {voidTarget && (
        <Modal onClose={() => setVoidTarget(null)} className="max-w-md" title="Anular pago">
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">Vas a anular el pago de {formatARS(voidTarget.amount_cents / 100)} del {formatDate(voidTarget.payment_date)}. Esta acción no se puede editar.</p>
            <div>
              <label className="block text-sm font-medium mb-1">Motivo *</label>
              <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Motivo de la anulación" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setVoidTarget(null)}>Cancelar</Button>
              <Button variant="danger" onClick={confirmVoid} disabled={submitting}>Anular pago</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
