import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';

const MAX_MOVEMENT = 100_000_000;

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
  const session = await loadOpenSession(id, auth.tenantId);
  if (!session) {
    return NextResponse.json({ error: 'No hay una caja abierta para esta sesión' }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    type?: 'in' | 'out';
    amount?: number;
    reason?: string;
  };

  if (!['in', 'out'].includes(body.type ?? '')) {
    return NextResponse.json({ error: 'El tipo de movimiento debe ser "in" o "out"' }, { status: 400 });
  }
  const amount = Math.round(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'El monto debe ser un número mayor a 0' }, { status: 400 });
  }
  if (amount > MAX_MOVEMENT) {
    return NextResponse.json({ error: 'El monto ingresado es demasiado alto' }, { status: 400 });
  }
  const reason = String(body.reason ?? '').trim();
  if (!reason) {
    return NextResponse.json({ error: 'Ingresá un motivo para el movimiento' }, { status: 400 });
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
    return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 });
  }

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: body.type === 'in' ? 'Ingreso manual de caja' : 'Egreso manual de caja',
    entityType: 'cash_movement',
    entityId: movement.id,
    details: { reason, amount_cents: movement.amount_cents },
  });

  return NextResponse.json({ movement }, { status: 201 });
}