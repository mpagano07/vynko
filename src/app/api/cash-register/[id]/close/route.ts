import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { computeExpectedCash } from '@/lib/cash-register';
import { createActivityLog } from '@/lib/activity-log';
import { PAYMENT_METHODS, type PaymentMethodId } from '@/lib/payment-methods';

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('role')
    .eq('user_id', auth.userId)
    .eq('tenant_id', auth.tenantId);
  if (!tu?.[0] || tu[0].role === 'viewer') {
    return NextResponse.json({ error: 'No tienes permisos para operar la caja' }, { status: 403 });
  }

  const id = request.url.split('/').at(-2) ?? '';
  const { data: session } = await supabaseAdmin
    .from('cash_register_sessions')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .eq('status', 'open')
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: 'No hay una caja abierta para esta sesión' }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    counted?: Record<string, number>;
    notes?: string;
  };
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
    return NextResponse.json({ error: 'Ingresá al menos un monto contado para cerrar la caja' }, { status: 400 });
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
    return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 });
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

  return NextResponse.json({
    report: {
      ...updated,
      expected_by_method: expected.byMethod,
      counted_by_method: counted,
      difference_by_method: difference,
    },
  });
}