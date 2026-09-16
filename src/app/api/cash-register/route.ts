import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { computeExpectedCash } from '@/lib/cash-register';
import { createActivityLog } from '@/lib/activity-log';

const MAX_INITIAL_FUND = 1_000_000_000;

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

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

  let open = sessions ?? null;
  if (open) {
    const expected = await computeExpectedCash(open.id, auth.tenantId);
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

  return NextResponse.json({ open, history: history ?? [] });
}

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

  const body = (await request.json().catch(() => ({}))) as { initial_fund?: number };
  const initial_fund = Math.round(Number(body.initial_fund));
  if (!Number.isFinite(initial_fund) || initial_fund < 0) {
    return NextResponse.json({ error: 'El fondo inicial debe ser un número mayor o igual a 0' }, { status: 400 });
  }
  if (initial_fund > MAX_INITIAL_FUND) {
    return NextResponse.json({ error: 'El fondo inicial ingresado es demasiado alto' }, { status: 400 });
  }

  const { data: open } = await supabaseAdmin
    .from('cash_register_sessions')
    .select('id')
    .eq('tenant_id', auth.tenantId)
    .eq('status', 'open')
    .maybeSingle();
  if (open) {
    return NextResponse.json({ error: 'Ya hay una caja abierta. Cerrá la sesión actual antes de abrir otra.' }, { status: 409 });
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
    return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 });
  }

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'Caja abierta',
    entityType: 'cash_register_session',
    entityId: session.id,
    details: { initial_fund_cents: session.initial_fund_cents },
  });

  return NextResponse.json({ session }, { status: 201 });
}

export async function DELETE() {
  return NextResponse.json({ error: 'Method not supported' }, { status: 405 });
}