import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';
import type { AuthInfo } from '@/lib/api-auth';
import { getRoleInTenant, hasCapability } from '@/lib/membership-role';
import { logger } from '@/lib/logger';

export type SupplierAccountResult<T = unknown> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

export type PayableStatus = 'pending' | 'partial' | 'paid' | 'overdue';

type TenantSettings = Record<string, unknown> & {
  purchases?: { account_current_cutoff_date?: string | null };
};

function isManagePurchasesRole(role: string | null | undefined) {
  return hasCapability(role, 'manage_purchases');
}

async function assertPurchasesManager(
  auth: AuthInfo
): Promise<{ ok: false; error: string; status: 403 } | null> {
  if (isManagePurchasesRole(await getRoleInTenant(auth.userId, auth.tenantId))) return null;
  return { ok: false, error: 'Solo el dueño o un administrador puede gestionar la cuenta corriente', status: 403 };
}

function toDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function addDays(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getAccountCutoffDate(tenantId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) {
    logger.error('getAccountCutoffDate:', { error });
    return null;
  }
  const settings = (data?.settings as TenantSettings | null) ?? null;
  const cutoff = settings?.purchases?.account_current_cutoff_date;
  return cutoff ? String(cutoff).slice(0, 10) : null;
}

export async function setAccountCutoffDate(
  auth: AuthInfo,
  cutoffDate: string | null
): Promise<SupplierAccountResult<{ cutoff_date: string | null }>> {
  const forbidden = await assertPurchasesManager(auth);
  if (forbidden) return forbidden;

  let normalized: string | null = null;
  if (cutoffDate !== null && cutoffDate !== '') {
    const s = String(cutoffDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return { ok: false, error: 'Fecha de corte inválida', status: 400 };
    }
    normalized = s;
  }

  const { data: tenant, error: readError } = await supabaseAdmin
    .from('tenants')
    .select('settings')
    .eq('id', auth.tenantId)
    .maybeSingle();
  if (readError) {
    logger.error('setAccountCutoffDate read:', { error: readError });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }
  const settings = ((tenant?.settings as TenantSettings | null) ?? {}) as TenantSettings;
  const purchases = { ...(settings.purchases ?? {}), account_current_cutoff_date: normalized };
  const nextSettings = { ...settings, purchases };

  const { error: updateError } = await supabaseAdmin
    .from('tenants')
    .update({ settings: nextSettings })
    .eq('id', auth.tenantId);
  if (updateError) {
    logger.error('setAccountCutoffDate update:', { error: updateError });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'updated',
    entityType: 'settings',
    details: { section: 'purchases_account_current', cutoff_date: normalized },
  });

  return { ok: true, data: { cutoff_date: normalized }, status: 200 };
}

function computeDueDate(params: {
  docDate: string | null;
  poDueDate: string | null;
  poTermDays: number | null;
}): string | null {
  if (params.poDueDate) return toDateOnly(params.poDueDate);
  if (params.poTermDays != null && params.docDate) {
    return addDays(params.docDate, Math.max(0, Math.trunc(params.poTermDays)));
  }
  return null;
}

function computeStatus(params: {
  debt: number;
  paid: number;
  dueDate: string | null;
  today: string;
}): PayableStatus {
  const balance = Math.max(0, params.debt - params.paid);
  if (params.debt <= 0 || balance === 0) return 'paid';
  if (params.paid > 0) {
    if (params.dueDate && params.today > params.dueDate) return 'overdue';
    return 'partial';
  }
  if (params.dueDate && params.today > params.dueDate) return 'overdue';
  return 'pending';
}

export interface PayableRow {
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
  po_payment_term_days: number | null;
  po_payment_due_date: string | null;
}

async function getSupplierOr404(auth: AuthInfo, supplierId: string) {
  const { data, error } = await supabaseAdmin
    .from('suppliers')
    .select('id, name, payment_term_days')
    .eq('id', supplierId)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return data as { id: string; name: string; payment_term_days: number | null };
}

async function fetchPayablesInternal(
  auth: AuthInfo,
  supplierId: string
): Promise<{ supplier: { id: string; name: string; payment_term_days: number | null } | null; cutoff: string | null; payables: PayableRow[]; error?: string }>{
  const supplier = await getSupplierOr404(auth, supplierId);
  if (!supplier) return { supplier: null, cutoff: null, payables: [] };

  const cutoff = await getAccountCutoffDate(auth.tenantId);

  const { data: docs, error: docsError } = await supabaseAdmin
    .from('commercial_documents')
    .select('id, document_number, purchase_order_id, total_cents, delivery_date, created_at, status, supplier_name')
    .eq('tenant_id', auth.tenantId)
    .eq('document_type', 'remito_ingreso')
    .eq('status', 'completed')
    .not('purchase_order_id', 'is', null)
    .order('delivery_date', { ascending: true });

  if (docsError) {
    logger.error('fetchPayables docs:', { error: docsError });
    return { supplier, cutoff, payables: [], error: 'Ocurrio un error inesperado. Intenta de nuevo.' };
  }

  const poIds = Array.from(new Set((docs ?? []).map((d) => d.purchase_order_id).filter(Boolean))) as string[];
  if (poIds.length === 0) {
    return { supplier, cutoff, payables: [] };
  }

  const { data: pos, error: poError } = await supabaseAdmin
    .from('purchase_orders')
    .select('id, supplier_id, payment_term_days, payment_due_date')
    .eq('tenant_id', auth.tenantId)
    .in('id', poIds);
  if (poError) {
    logger.error('fetchPayables pos:', { error: poError });
    return { supplier, cutoff, payables: [], error: 'Ocurrio un error inesperado. Intenta de nuevo.' };
  }

  const poMap = new Map<string, { supplier_id: string; payment_term_days: number | null; payment_due_date: string | null }>();
  for (const po of pos ?? []) {
    poMap.set(po.id as string, {
      supplier_id: po.supplier_id as string,
      payment_term_days: (po.payment_term_days as number | null) ?? null,
      payment_due_date: (po.payment_due_date as string | null) ?? null,
    });
  }

  const eligibleDocs = (docs ?? []).filter((d) => {
    const po = poMap.get(d.purchase_order_id as string);
    if (!po || po.supplier_id !== supplierId) return false;
    const docDate = toDateOnly((d.delivery_date as string | null) ?? (d.created_at as string | null));
    if (cutoff && docDate && docDate < cutoff) return false;
    return true;
  });

  const docIds = eligibleDocs.map((d) => d.id as string);
  const paidByDoc = new Map<string, number>();
  if (docIds.length > 0) {
    const { data: allocs, error: allocError } = await supabaseAdmin
      .from('supplier_payment_allocations')
      .select('document_id, amount_cents, payment:supplier_payments!inner(status)')
      .eq('tenant_id', auth.tenantId)
      .in('document_id', docIds);
    if (allocError) {
      logger.error('fetchPayables allocs:', { error: allocError });
      return { supplier, cutoff, payables: [], error: 'Ocurrio un error inesperado. Intenta de nuevo.' };
    }
    for (const a of allocs ?? []) {
      const payment = a.payment as { status?: string } | { status?: string }[] | null;
      const status = Array.isArray(payment) ? payment[0]?.status : payment?.status;
      if (status !== 'posted') continue;
      const docId = a.document_id as string;
      paidByDoc.set(docId, (paidByDoc.get(docId) ?? 0) + (Number(a.amount_cents) || 0));
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const payables: PayableRow[] = eligibleDocs.map((d) => {
    const po = poMap.get(d.purchase_order_id as string)!;
    const docDate = toDateOnly((d.delivery_date as string | null) ?? (d.created_at as string | null));
    const debt = Number(d.total_cents) || 0;
    const paid = paidByDoc.get(d.id as string) ?? 0;
    const dueDate = computeDueDate({ docDate, poDueDate: po.payment_due_date, poTermDays: po.payment_term_days });
    const status = computeStatus({ debt, paid, dueDate, today });
    return {
      document_id: d.id as string,
      purchase_order_id: d.purchase_order_id as string,
      document_number: (d.document_number as number | null) ?? null,
      document_date: docDate,
      supplier_name: (d.supplier_name as string | null) ?? supplier.name,
      debt_cents: debt,
      paid_cents: paid,
      balance_cents: Math.max(0, debt - paid),
      due_date: dueDate,
      status,
      po_payment_term_days: po.payment_term_days,
      po_payment_due_date: po.payment_due_date,
    };
  });

  return { supplier, cutoff, payables };
}

export async function getSupplierAccount(auth: AuthInfo, supplierId: string): Promise<SupplierAccountResult> {
  const forbidden = await assertPurchasesManager(auth);
  if (forbidden) return forbidden;

  const { supplier, cutoff, payables, error } = await fetchPayablesInternal(auth, supplierId);
  if (!supplier) return { ok: false, error: 'Proveedor no encontrado', status: 404 };
  if (error) return { ok: false, error, status: 500 };

  const totals = payables.reduce(
    (acc, p) => {
      acc.debt_cents += p.debt_cents;
      acc.paid_cents += p.paid_cents;
      acc.balance_cents += p.balance_cents;
      if (p.status === 'overdue') acc.overdue_count += 1;
      if (p.status === 'pending' || p.status === 'partial') acc.open_count += 1;
      return acc;
    },
    { debt_cents: 0, paid_cents: 0, balance_cents: 0, overdue_count: 0, open_count: 0 }
  );

  const { data: payments, error: payError } = await supabaseAdmin
    .from('supplier_payments')
    .select('id, amount_cents, payment_date, method, reference, notes, status, void_reason, voided_at, created_at')
    .eq('tenant_id', auth.tenantId)
    .eq('supplier_id', supplierId)
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (payError) {
    logger.error('getSupplierAccount payments:', { error: payError });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  return {
    ok: true,
    status: 200,
    data: {
      supplier,
      cutoff_date: cutoff,
      summary: totals,
      payables,
      payments: payments ?? [],
    },
  };
}

export interface CreateSupplierPaymentInput {
  amount_cents: number;
  payment_date: string;
  method?: string;
  reference?: string | null;
  notes?: string | null;
  allocations: { purchase_order_id: string; document_id: string; amount_cents: number }[];
}

export async function createSupplierPayment(
  auth: AuthInfo,
  supplierId: string,
  input: CreateSupplierPaymentInput
): Promise<SupplierAccountResult> {
  const forbidden = await assertPurchasesManager(auth);
  if (forbidden) return forbidden;

  const supplier = await getSupplierOr404(auth, supplierId);
  if (!supplier) return { ok: false, error: 'Proveedor no encontrado', status: 404 };

  const amount = Number(input.amount_cents);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    return { ok: false, error: 'El monto del pago debe ser un entero positivo en centavos', status: 400 };
  }
  const allocations = Array.isArray(input.allocations) ? input.allocations : [];
  if (allocations.length === 0) {
    return { ok: false, error: 'El pago debe imputarse a al menos un documento', status: 400 };
  }
  const allocSum = allocations.reduce((s, a) => s + (Number(a.amount_cents) || 0), 0);
  if (allocSum !== amount) {
    return { ok: false, error: 'La suma de las imputaciones debe ser igual al monto del pago', status: 400 };
  }

  // Recalcular saldos actuales y validar documentos/imputaciones
  const { payables, error } = await fetchPayablesInternal(auth, supplierId);
  if (error) return { ok: false, error, status: 500 };
  const payableByDoc = new Map(payables.map((p) => [p.document_id, p]));

  for (const a of allocations) {
    const aAmount = Number(a.amount_cents);
    if (!Number.isInteger(aAmount) || aAmount <= 0) {
      return { ok: false, error: 'Cada imputación debe tener un monto entero positivo', status: 400 };
    }
    if (!a.document_id) {
      return { ok: false, error: 'Cada imputación debe indicar el documento/recepción', status: 400 };
    }
    const payable = payableByDoc.get(a.document_id);
    if (!payable) {
      return { ok: false, error: 'Uno o más documentos no son válidos, no pertenecen al proveedor o están fuera de la cuenta corriente', status: 400 };
    }
    if (payable.purchase_order_id !== a.purchase_order_id) {
      return { ok: false, error: 'La imputación no coincide con la orden de compra del documento', status: 400 };
    }
    if (aAmount > payable.balance_cents) {
      return { ok: false, error: 'Una imputación supera el saldo pendiente del documento', status: 400 };
    }
  }

  const paymentDate = toDateOnly(input.payment_date) ?? new Date().toISOString().slice(0, 10);
  const { data: payment, error: payError } = await supabaseAdmin
    .from('supplier_payments')
    .insert({
      tenant_id: auth.tenantId,
      supplier_id: supplierId,
      amount_cents: amount,
      payment_date: paymentDate,
      method: input.method || 'other',
      reference: input.reference || null,
      notes: input.notes || null,
      status: 'posted',
      created_by: auth.userId,
    })
    .select()
    .single();

  if (payError || !payment) {
    logger.error('createSupplierPayment insert:', { error: payError });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const rows = allocations.map((a) => ({
    tenant_id: auth.tenantId,
    payment_id: payment.id,
    purchase_order_id: a.purchase_order_id,
    document_id: a.document_id,
    amount_cents: Number(a.amount_cents),
  }));
  const { error: allocError } = await supabaseAdmin.from('supplier_payment_allocations').insert(rows);
  if (allocError) {
    logger.error('createSupplierPayment allocs:', { error: allocError });
    // compensación best-effort
    await supabaseAdmin.from('supplier_payments').delete().eq('id', payment.id).eq('tenant_id', auth.tenantId);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'created',
    entityType: 'supplier_payment',
    entityId: payment.id,
    details: { supplier_id: supplierId, amount_cents: amount, allocations: rows.map((r) => ({ document_id: r.document_id, amount_cents: r.amount_cents })) },
  });

  return { ok: true, status: 201, data: payment };
}

export async function voidSupplierPayment(
  auth: AuthInfo,
  paymentId: string,
  reason: string
): Promise<SupplierAccountResult> {
  const forbidden = await assertPurchasesManager(auth);
  if (forbidden) return forbidden;

  const trimmed = (reason || '').trim();
  if (!trimmed) return { ok: false, error: 'El motivo de anulación es requerido', status: 400 };

  const { data: payment, error: readError } = await supabaseAdmin
    .from('supplier_payments')
    .select('id, tenant_id, supplier_id, status, amount_cents')
    .eq('id', paymentId)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle();
  if (readError || !payment) {
    return { ok: false, error: 'Pago no encontrado', status: 404 };
  }
  if (payment.status === 'voided') {
    return { ok: false, error: 'El pago ya está anulado', status: 400 };
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('supplier_payments')
    .update({ status: 'voided', voided_at: now, voided_by: auth.userId, void_reason: trimmed, updated_at: now })
    .eq('id', paymentId)
    .eq('tenant_id', auth.tenantId)
    .eq('status', 'posted')
    .select()
    .single();
  if (updateError || !updated) {
    logger.error('voidSupplierPayment:', { error: updateError });
    return { ok: false, error: 'No se pudo anular el pago', status: 400 };
  }

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'cancelled',
    entityType: 'supplier_payment',
    entityId: paymentId,
    details: { supplier_id: payment.supplier_id, amount_cents: payment.amount_cents, reason: trimmed },
  });

  return { ok: true, status: 200, data: updated };
}
