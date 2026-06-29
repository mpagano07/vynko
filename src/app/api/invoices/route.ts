import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requestCae, getInvoiceTotals } from '@/lib/afip';
import type { AfipInvoiceRequest, InvoiceType, IvaCondition, DocumentType } from '@/lib/types/invoice';

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

export async function GET() {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { data: invoices, error } = await supabaseAdmin
    .from('electronic_invoices')
    .select('*, items:invoice_items(*)')
    .eq('tenant_id', auth.tenantId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(invoices ?? []);
}

export async function POST(request: Request) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const body = await request.json();
    const { sale_id, invoice_type, customer_id, customer_name, document_type, document_number, iva_condition, cuit_receptor, items } = body as AfipInvoiceRequest & { sale_id?: string };

    if (!customer_name || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Faltan datos requeridos (cliente, items)' }, { status: 400 });
    }

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('cuit, punto_venta, iva_condition')
      .eq('id', auth.tenantId)
      .single();

    if (!tenant?.cuit) {
      return NextResponse.json({ error: 'Configuración de AFIP incompleta. Configurá el CUIT del negocio en Ajustes.' }, { status: 400 });
    }

    const cuitEmisor = tenant.cuit;
    const puntoVenta = tenant.punto_venta ?? 1;

    const { data: seqResult } = await supabaseAdmin
      .from('invoice_sequences')
      .select('next_number')
      .eq('tenant_id', auth.tenantId)
      .eq('punto_venta', puntoVenta)
      .eq('invoice_type', invoice_type ?? 'B')
      .single();

    let nextNumber = 1;
    if (seqResult) {
      nextNumber = seqResult.next_number as number;
    } else {
      await supabaseAdmin
        .from('invoice_sequences')
        .insert({
          tenant_id: auth.tenantId,
          punto_venta: puntoVenta,
          invoice_type: invoice_type ?? 'B',
          next_number: 1,
        });
    }

    const totals = getInvoiceTotals(items, invoice_type ?? 'B');

    const afipInvoice: AfipInvoiceRequest = {
      invoice_type: (invoice_type as InvoiceType) ?? 'B',
      customer_name,
      document_type: (document_type as DocumentType) ?? 'DNI',
      document_number,
      iva_condition: (iva_condition as IvaCondition) ?? 'consumidor_final',
      cuit_receptor,
      items: items.map(i => ({
        description: i.description,
        quantity: i.quantity,
        unit_price_cents: i.unit_price_cents,
        iva_percentage: i.iva_percentage ?? 21,
      })),
    };

    const afipResult = await requestCae({ cuit: cuitEmisor, punto_venta: puntoVenta }, afipInvoice);

    const { data: invoice, error: invError } = await supabaseAdmin
      .from('electronic_invoices')
      .insert({
        tenant_id: auth.tenantId,
        sale_id: sale_id || null,
        invoice_number: nextNumber,
        punto_venta: puntoVenta,
        invoice_type: invoice_type ?? 'B',
        cuit_emisor: cuitEmisor,
        cuit_receptor: cuit_receptor || null,
        customer_id: customer_id || null,
        customer_name,
        document_type: document_type ?? 'DNI',
        document_number: document_number || null,
        iva_condition: iva_condition ?? 'consumidor_final',
        total_cents: totals.total_cents,
        net_cents: totals.net_cents,
        iva_cents: totals.iva_cents,
        iva_percentage: 21,
        other_taxes_cents: 0,
        cae: afipResult.data?.cae ?? null,
        cae_due_date: afipResult.data?.cae_due_date ?? null,
        afip_result: afipResult.data?.result ?? null,
        afip_response: afipResult.data ? (afipResult.data as unknown as Record<string, unknown>) : null,
        status: afipResult.success ? 'approved' : 'rejected',
        created_by: auth.userId,
      })
      .select()
      .single();

    if (invError) {
      return NextResponse.json({ error: invError.message }, { status: 400 });
    }

    const invoiceItems = items.map(item => ({
      invoice_id: invoice.id,
      product_id: item.product_id || null,
      description: item.description,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      subtotal_cents: item.unit_price_cents * item.quantity,
      iva_percentage: item.iva_percentage ?? 21,
      iva_cents: Math.round((item.unit_price_cents * item.quantity) * ((item.iva_percentage ?? 21) / 100)),
    }));

    const { error: itemsError } = await supabaseAdmin
      .from('invoice_items')
      .insert(invoiceItems);

    if (itemsError) {
      await supabaseAdmin.from('electronic_invoices').delete().eq('id', invoice.id);
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }

    if (afipResult.success) {
      await supabaseAdmin
        .from('invoice_sequences')
        .update({ next_number: nextNumber + 1, updated_at: new Date().toISOString() })
        .eq('tenant_id', auth.tenantId)
        .eq('punto_venta', puntoVenta)
        .eq('invoice_type', invoice_type ?? 'B');
    }

    const { data: fullInvoice } = await supabaseAdmin
      .from('electronic_invoices')
      .select('*, items:invoice_items(*)')
      .eq('id', invoice.id)
      .single();

    return NextResponse.json(fullInvoice, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al generar factura electrónica';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
