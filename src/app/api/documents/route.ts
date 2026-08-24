import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { CreateDocumentRequest, DocumentType } from '@/lib/types/document';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const documentType = searchParams.get('type') as DocumentType | null;
  const purchaseOrderId = searchParams.get('purchase_order_id');

  let query = supabaseAdmin
    .from('commercial_documents')
    .select('*, items:commercial_document_items(*)')
    .eq('tenant_id', auth.tenantId);

  if (documentType) {
    query = query.eq('document_type', documentType);
  }

  if (purchaseOrderId) {
    query = query.eq('purchase_order_id', purchaseOrderId);
  }

  query = query.order('created_at', { ascending: false });

  const { data: documents, error } = await query;

  if (error) { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }
  return NextResponse.json(documents ?? []);
}

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const body = await request.json();
    const {
      document_type,
      sale_id,
      purchase_order_id,
      customer_id,
      customer_name,
      supplier_name,
      notes,
      valid_until,
      delivery_date,
      items,
    } = body as CreateDocumentRequest & { sale_id?: string; purchase_order_id?: string };

    if (!document_type || !customer_name || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Faltan datos requeridos (tipo documento, cliente, items)' }, { status: 400 });
    }

    const validTypes: DocumentType[] = ['remito_salida', 'remito_ingreso', 'presupuesto', 'orden_compra', 'orden_venta'];
    if (!validTypes.includes(document_type)) {
      return NextResponse.json({ error: 'Tipo de documento inválido' }, { status: 400 });
    }

    const totalCents = items.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);

    let document: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 5 && !document; attempt++) {
      const { data: seqResult } = await supabaseAdmin
        .from('commercial_document_sequences')
        .select('next_number')
        .eq('tenant_id', auth.tenantId)
        .eq('document_type', document_type)
        .single();

      const candidate = (seqResult?.next_number as number) ?? 1;
      if (!seqResult) {
        await supabaseAdmin
          .from('commercial_document_sequences')
          .upsert({
            tenant_id: auth.tenantId,
            document_type,
            next_number: candidate,
          }, { onConflict: 'tenant_id,document_type' });
      }

      const { data: claimed } = await supabaseAdmin
        .from('commercial_document_sequences')
        .update({ next_number: candidate + 1, updated_at: new Date().toISOString() })
        .eq('tenant_id', auth.tenantId)
        .eq('document_type', document_type)
        .eq('next_number', candidate)
        .select('next_number');

      if (!claimed || claimed.length === 0) continue;

      const { data, error } = await supabaseAdmin
        .from('commercial_documents')
        .insert({
          tenant_id: auth.tenantId,
          document_type,
          document_number: candidate,
          sale_id: sale_id || null,
          purchase_order_id: purchase_order_id || null,
          customer_id: customer_id || null,
          customer_name,
          supplier_name: supplier_name || null,
          notes: notes || null,
          total_cents: totalCents,
          status: 'pending',
          valid_until: valid_until || null,
          delivery_date: delivery_date || null,
          created_by: auth.userId,
        })
        .select()
        .single();

      if (!error) {
        document = data as Record<string, unknown>;
      }
    }

    if (!document) {
      return NextResponse.json(
        { error: 'No se pudo generar el número de documento. Intentá de nuevo.' },
        { status: 409 }
      );
    }

    const documentItems = items.map(item => ({
      document_id: document.id,
      product_id: item.product_id || null,
      description: item.description,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      subtotal_cents: item.unit_price_cents * item.quantity,
    }));

    const { error: itemsError } = await supabaseAdmin
      .from('commercial_document_items')
      .insert(documentItems);

    if (itemsError) {
      await supabaseAdmin.from('commercial_documents').delete().eq('id', document.id);
      { console.error('DB error:', itemsError); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 400 }); }
    }

    const { data: fullDocument } = await supabaseAdmin
      .from('commercial_documents')
      .select('*, items:commercial_document_items(*)')
      .eq('id', document.id)
      .single();

    return NextResponse.json(fullDocument, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al crear documento';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
