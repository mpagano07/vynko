import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';
import { PLANS } from '@/lib/plans';
import { createPreApproval } from '@/lib/mercadopago';

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', user.id);
  if (!tu || tu.length === 0) return NextResponse.json({ error: 'No tenant' }, { status: 401 });

  const activeTenantId = request.headers.get('x-active-tenant-id');
  const membership = activeTenantId ? tu.find(t => t.tenant_id === activeTenantId) : undefined;
  const tenantId = membership ? membership.tenant_id : tu[0].tenant_id;

  const canManage = tu.some(
    t => t.tenant_id === tenantId && (t.role === 'owner' || t.role === 'admin')
  );
  if (!canManage) {
    return NextResponse.json(
      { error: 'Solo el owner o admins pueden gestionar la suscripción' },
      { status: 403 }
    );
  }

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name, billing_email')
    .eq('id', tenantId)
    .single();

  let plan: unknown;
  try {
    ({ plan } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const planConfig = PLANS[plan as keyof typeof PLANS];

  if (!planConfig || planConfig.comingSoon) {
    return NextResponse.json({ error: 'Plan inválido o no disponible' }, { status: 400 });
  }

  // Enterprise se activa manualmente por ventas (cotización a medida), no vía
  // Mercado Pago recurrente. Devolvemos una acción de contacto para que la UI
  // muestre el CTA de ventas en lugar de redirigir a un checkout.
  if (planConfig.id === 'enterprise') {
    return NextResponse.json(
      { error: 'El plan Enterprise se activa por ventas', needsSalesContact: true },
      { status: 400 }
    );
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || '';

  try {
    const preapproval = await createPreApproval({
      payer_email: tenant?.billing_email || user.email!,
      reason: `Suscripción ${planConfig.name} - Vynko`,
      back_url: `${origin}/billing?success=true`,
      external_reference: `${tenantId}:${planConfig.id}`,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: planConfig.price,
        currency_id: 'ARS',
        trial_period_days: planConfig.id === 'starter' ? 45 : 0,
      },
    });

    await supabaseAdmin
      .from('tenants')
      .update({ mercadopago_preapproval_id: preapproval.id })
      .eq('id', tenantId);

    return NextResponse.json({ url: preapproval.init_point });
  } catch (err) {
    console.error('Error creating MercadoPago preapproval:', err);
    return NextResponse.json(
      { error: 'No se pudo iniciar el pago. Intentá de nuevo en unos minutos.' },
      { status: 502 }
    );
  }
}
