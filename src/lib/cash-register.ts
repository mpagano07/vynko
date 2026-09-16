import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { PAYMENT_METHODS, type PaymentMethodId } from '@/lib/payment-methods';

export interface CashExpectedTotals {
  byMethod: Record<PaymentMethodId, number>;
  total: number;
}

/**
 * Calcula lo que la caja DEBERÍA tener para una sesión abierta:
 * - Efectivo: fondo inicial + neto de ventas en efectivo + ingresos manuales
 *   - egresos manuales.
 * - Medios no efectivo: saldo neto de ventas (dinero pendiente de depósito).
 */
export async function computeExpectedCash(
  sessionId: string,
  tenantId: string
): Promise<CashExpectedTotals> {
  const byMethod: Record<PaymentMethodId, number> = {
    cash: 0,
    transfer: 0,
    debit: 0,
    credit: 0,
    mercadopago: 0,
  };

  const { data: session } = await supabaseAdmin
    .from('cash_register_sessions')
    .select('initial_fund_cents')
    .eq('id', sessionId)
    .eq('tenant_id', tenantId)
    .single();

  byMethod.cash += session?.initial_fund_cents ?? 0;

  const { data: salesRows } = await supabaseAdmin
    .from('sales')
    .select('id')
    .eq('session_id', sessionId)
    .eq('tenant_id', tenantId);

  const saleIds = (salesRows ?? []).map((r) => r.id);
  if (saleIds.length > 0) {
    const { data: payments } = await supabaseAdmin
      .from('sale_payments')
      .select('method, amount_cents')
      .in('sale_id', saleIds);
    for (const p of payments ?? []) {
      if (isPaymentMethodIdLike(p.method)) {
        byMethod[p.method as PaymentMethodId] += Number(p.amount_cents) || 0;
      }
    }
  }

  const { data: movements } = await supabaseAdmin
    .from('cash_movements')
    .select('type, amount_cents')
    .eq('session_id', sessionId);

  for (const m of movements ?? []) {
    const signed = m.type === 'in' ? Number(m.amount_cents) || 0 : -(Number(m.amount_cents) || 0);
    byMethod.cash += signed;
  }

  const total = PAYMENT_METHODS.reduce((sum, m) => sum + byMethod[m.id], 0);
  return { byMethod, total };
}

function isPaymentMethodIdLike(value: unknown): boolean {
  return PAYMENT_METHODS.some((m) => m.id === value);
}