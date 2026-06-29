import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

async function getAuth() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);
  if (!tu || tu.length === 0) return null;
  return { tenantId: tu[0].tenant_id as string, userId: user.id };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;

  const { data: invoice, error } = await supabaseAdmin
    .from('electronic_invoices')
    .select('*, items:invoice_items(*)')
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .single();

  if (error) return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 });
  return NextResponse.json(invoice);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;

  const body = await request.json();
  const { status } = body as { status?: string };

  if (status === 'cancelled') {
    const { data: invoice } = await supabaseAdmin
      .from('electronic_invoices')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', auth.tenantId)
      .single();

    if (!invoice) return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 });

    if (invoice.status !== 'approved') {
      return NextResponse.json({ error: 'Solo se pueden anular facturas aprobadas' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('electronic_invoices')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', auth.tenantId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: 'Acción no soportada' }, { status: 400 });
}
