import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { computeExpectedCash } from '@/lib/cash-register';
import { createActivityLog } from '@/lib/activity-log';
import { PAYMENT_METHODS, type PaymentMethodId } from '@/lib/payment-methods';
import type { AuthInfo } from '@/lib/api-auth';
import { trackEvent } from '@/lib/track-event';

export type CashRegisterResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

const MAX_INITIAL_FUND = 1_000_000_000;
const MAX_MOVEMENT = 100_000_000;

// Roles válidos en `tenant_users.role`: 'owner' | 'manager' | 'member'.
// Un 'member' no debe poder mover dinero: antes esta comprobación comparaba con
// 'viewer', un rol que el CHECK de la tabla nunca permite, así que cualquier
// miembro pasaba el filtro.
const CASH_OPERATOR_ROLES = new Set(['owner', 'manager']);

async function assertOperatorRole(auth: AuthInfo): Promise<CashRegisterResult<never> | null> {
  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('role')
    .eq('user_id', auth.userId)
    .eq('tenant_id', auth.tenantId);
  const role = (tu?.[0]?.role as string | undefined) ?? null;
  if (!role || !CASH_OPERATOR_ROLES.has(role)) {
    return { ok: false, error: 'No tienes permisos para operar la caja', status: 403 };
  }
  return null;
}

async function loadOpenSession(id: string, tenantId: string) {
  const { data } = await supabaseAdmin
    .from('cash_register_sessions')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .maybeSingle();
  return data ?? null;
}

export async function getCashRegister(auth: AuthInfo): Promise<CashRegisterResult<{ open: unknown; history: unknown }>> {
  const [{ data: sessions }, { data: history }] = await Promise.all([
    supabaseAdmin
      .from('cash_register_sessions')
      .select('*')
      .eq('tenant_id', auth.tenantId)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('cash_register_sessions')
      .select('*')
      .eq('tenant_id', auth.tenantId)
      .eq('status', 'closed')
      .order('closed_at', { ascending: false })
      .limit(10),
  ]);

  let open = (sessions as Record<string, unknown> | null) ?? null;
  if (open) {
    const expected = await computeExpectedCash(open.id as string, auth.tenantId);
    const [salesCount, movements] = await Promise.all([
      supabaseAdmin
        .from('sales')
        .select('total_cents, status')
        .eq('session_id', open.id)
        .eq('tenant_id', auth.tenantId),
      supabaseAdmin
        .from('cash_movements')
        .select('*')
        .eq('session_id', open.id)
        .order('created_at', { ascending: false }),
    ]);
    open = {
      ...open,
      expected_by_method: expected.byMethod,
      total_expected: expected.total,
      sales_count: (salesCount.data ?? []).length,
      sales_total: (salesCount.data ?? []).reduce(
        (sum, s) => sum + (s.status === 'completed' ? Number(s.total_cents) || 0 : 0),
        0
      ),
      movements: movements.data ?? [],
    };
  }

  return { ok: true, data: { open, history: history ?? [] }, status: 200 };
}

export async function openCashRegister(auth: AuthInfo, body: { initial_fund?: number }): Promise<CashRegisterResult<{ session: unknown }>> {
  const roleError = await assertOperatorRole(auth);
  if (roleError) return roleError;

  const initial_fund = Math.round(Number(body.initial_fund));
  if (!Number.isFinite(initial_fund) || initial_fund < 0) {
    return { ok: false, error: 'El fondo inicial debe ser un número mayor o igual a 0', status: 400 };
  }
  if (initial_fund > MAX_INITIAL_FUND) {
    return { ok: false, error: 'El fondo inicial ingresado es demasiado alto', status: 400 };
  }

  const { data: open } = await supabaseAdmin
    .from('cash_register_sessions')
    .select('id')
    .eq('tenant_id', auth.tenantId)
    .eq('status', 'open')
    .maybeSingle();
  if (open) {
    return { ok: false, error: 'Ya hay una caja abierta. Cerrá la sesión actual antes de abrir otra.', status: 409 };
  }

  const { data: session, error } = await supabaseAdmin
    .from('cash_register_sessions')
    .insert({
      tenant_id: auth.tenantId,
      opened_by: auth.userId,
      initial_fund_cents: Math.round(initial_fund * 100),
      status: 'open',
    })
    .select()
    .single();

  if (error || !session) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'Caja abierta',
    entityType: 'cash_register_session',
    entityId: session.id,
    details: { initial_fund_cents: session.initial_fund_cents },
  });

  await trackEvent({
    type: 'first_cash_open',
    userId: auth.userId,
    tenantId: auth.tenantId,
    metadata: { sessionId: session.id, initialFundCents: session.initial_fund_cents },
  });

  return { ok: true, data: { session }, status: 201 };
}

export async function closeCashRegister(
  auth: AuthInfo,
  id: string,
  body: { counted?: Record<string, number>; notes?: string }
): Promise<CashRegisterResult<{ report: Record<string, unknown> }>> {
  const roleError = await assertOperatorRole(auth);
  if (roleError) return roleError;

  const session = await loadOpenSession(id, auth.tenantId);
  if (!session) {
    return { ok: false, error: 'No hay una caja abierta para esta sesión', status: 404 };
  }

  const notes = String(body.notes ?? '').trim().slice(0, 500);

  const expected = await computeExpectedCash(session.id, auth.tenantId);

  const counted: Record<PaymentMethodId, number> = {
    cash: 0,
    transfer: 0,
    debit: 0,
    credit: 0,
    mercadopago: 0,
  };
  const rawCounted = body.counted ?? {};
  let hasCountedValue = false;
  for (const method of PAYMENT_METHODS) {
    const v = Number(rawCounted[method.id]);
    if (Number.isFinite(v) && v >= 0) {
      counted[method.id] = Math.round(v * 100);
      if (counted[method.id] > 0) hasCountedValue = true;
    }
  }
  if (!hasCountedValue) {
    return { ok: false, error: 'Ingresá al menos un monto contado para cerrar la caja', status: 400 };
  }

  const difference = PAYMENT_METHODS.reduce<Record<PaymentMethodId, number>>((acc, m) => {
    acc[m.id] = counted[m.id] - expected.byMethod[m.id];
    return acc;
  }, {} as Record<PaymentMethodId, number>);

  const total_expected = expected.total;
  const total_counted = PAYMENT_METHODS.reduce((sum, m) => sum + counted[m.id], 0);
  const total_difference = total_counted - total_expected;

  const { data: updated, error } = await supabaseAdmin
    .from('cash_register_sessions')
    .update({
      status: 'closed',
      closed_by: auth.userId,
      closed_at: new Date().toISOString(),
      total_expected_cents: total_expected,
      total_counted_cents: total_counted,
      total_difference_cents: total_difference,
      expected_by_method: expected.byMethod,
      counted_by_method: counted,
      difference_by_method: difference,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)
    .select()
    .single();

  if (error || !updated) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'Caja cerrada',
    entityType: 'cash_register_session',
    entityId: session.id,
    details: {
      total_expected_cents: total_expected,
      total_counted_cents: total_counted,
      total_difference_cents: total_difference,
    },
  });

  return {
    ok: true,
    status: 200,
    data: {
      report: {
        ...updated,
        expected_by_method: expected.byMethod,
        counted_by_method: counted,
        difference_by_method: difference,
      },
    },
  };
}

export async function recordCashMovement(
  auth: AuthInfo,
  id: string,
  body: { type?: string; amount?: number; reason?: string }
): Promise<CashRegisterResult<{ movement: unknown }>> {
  const roleError = await assertOperatorRole(auth);
  if (roleError) return roleError;

  const session = await loadOpenSession(id, auth.tenantId);
  if (!session) {
    return { ok: false, error: 'No hay una caja abierta para esta sesión', status: 404 };
  }

  if (!['in', 'out'].includes(body.type ?? '')) {
    return { ok: false, error: 'El tipo de movimiento debe ser "in" o "out"', status: 400 };
  }
  const amount = Math.round(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'El monto debe ser un número mayor a 0', status: 400 };
  }
  if (amount > MAX_MOVEMENT) {
    return { ok: false, error: 'El monto ingresado es demasiado alto', status: 400 };
  }
  const reason = String(body.reason ?? '').trim();
  if (!reason) {
    return { ok: false, error: 'Ingresá un motivo para el movimiento', status: 400 };
  }

  const { data: movement, error } = await supabaseAdmin
    .from('cash_movements')
    .insert({
      tenant_id: auth.tenantId,
      session_id: session.id,
      amount_cents: Math.round(amount * 100),
      type: body.type,
      reason,
      created_by: auth.userId,
    })
    .select()
    .single();

  if (error || !movement) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: body.type === 'in' ? 'Ingreso manual de caja' : 'Egreso manual de caja',
    entityType: 'cash_movement',
    entityId: movement.id,
    details: { reason, amount_cents: movement.amount_cents },
  });

  return { ok: true, data: { movement }, status: 201 };
}