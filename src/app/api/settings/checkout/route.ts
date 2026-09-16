import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  normalizeCheckoutSettings,
  PAYMENT_METHODS,
  type CheckoutSettings,
} from '@/lib/payment-methods';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('settings')
    .eq('id', auth.tenantId)
    .single();

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('role')
    .eq('user_id', auth.userId)
    .eq('tenant_id', auth.tenantId);

  const role = tu?.[0]?.role;
  const canEdit = role === 'owner' || role === 'manager';

  const settings = normalizeCheckoutSettings(
    (tenant?.settings as Record<string, unknown> | undefined)?.checkout
  );
  return NextResponse.json({ checkout: settings, settings, canEdit });
}

export async function PUT(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('role')
    .eq('user_id', auth.userId)
    .eq('tenant_id', auth.tenantId);

  const membership = tu?.[0];
  if (!membership) {
    return NextResponse.json({ error: 'No tenant found' }, { status: 404 });
  }
  if (!['owner', 'manager'].includes(membership.role)) {
    return NextResponse.json({ error: 'Solo el dueño o un administrador puede cambiar la configuración de cobro' }, { status: 403 });
  }

  const body = (await request.json()) as Partial<CheckoutSettings>;
  const next = normalizeCheckoutSettings(body);

  const { data: current } = await supabaseAdmin
    .from('tenants')
    .select('settings')
    .eq('id', auth.tenantId)
    .single();

  const raw = (current?.settings as Record<string, unknown> | undefined) ?? {};
  const settings = {
    ...(typeof raw === 'object' && raw !== null ? raw : {}),
    checkout: next,
  };

  const { error } = await supabaseAdmin
    .from('tenants')
    .update({ settings, updated_at: new Date().toISOString() })
    .eq('id', auth.tenantId);

  if (error) {
    console.error('DB error:', error);
    return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 });
  }

  const adjustments = PAYMENT_METHODS.map((m) => `${m.label}: ${next.payment_adjustments[m.id]}%`).join(', ');
  return NextResponse.json({ checkout: next, saved: true, adjustments });
}