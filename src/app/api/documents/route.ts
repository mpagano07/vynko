import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { CreateDocumentRequest, DocumentType } from '@/lib/types/document';

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

export async function GET(request: Request) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const documentType = searchParams.get('type') as DocumentType | null;

  let query = supabaseAdmin
    .from('commercial_documents')
    .select('*, items:commercial_document_items(*)')
    .eq('tenant_id', auth.tenantId)
    .order('created_at', { ascending: false });

  if (documentType) {
    query = query.eq('document_type', documentType);
  }

  const { data: documents, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(documents ?? []);
}

export async function POST(request: Request) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const body = await request.json();
    const {
      document_type,
      sale_id,
      customer_id,
      customer_name,
      supplier_name,
      notes,
      valid_until,
      delivery_date,
      items,
    } = body as CreateDocumentRequest & { sale_id?: string };

    if (!document_type || !customer_name || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Faltan datos requeridos (tipo documento, cliente, items)' }, { status: 400 });
    }

    const validTypes: DocumentType[] = ['remito_salida', 'remito_ingreso', 'presupuesto', 'orden_compra', 'orden_venta'];
    if (!validTypes.includes(document_type)) {
      return NextResponse.json({ error: 'Tipo de documento inválido' }, { status: 400 });
    }

    const { data: seqResult } = await supabaseAdmin
      .from('commercial_document_sequences')
      .select('next_number')
      .eq('tenant_id', auth.tenantId)
      .eq('document_type', document_type)
      .single();

    let nextNumber = 1;
    if (seqResult) {
      nextNumber = seqResult.next_number as number;
    } else {
      await supabaseAdmin
        .from('commercial_document_sequences')
        .insert({
          tenant_id: auth.tenantId,
          document_type,
          next_number: 1,
        });
    }

    const totalCents = items.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);

    const { data: document, error: docError } = await supabaseAdmin
      .from('commercial_documents')
      .insert({
        tenant_id: auth.tenantId,
        document_type,
        document_number: nextNumber,
        sale_id: sale_id || null,
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

    if (docError) {
      return NextResponse.json({ error: docError.message }, { status: 400 });
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
      return NextResponse.json({ error: itemsError.message }, { status: 400 });
    }

    await supabaseAdmin
      .from('commercial_document_sequences')
      .update({ next_number: nextNumber + 1, updated_at: new Date().toISOString() })
      .eq('tenant_id', auth.tenantId)
      .eq('document_type', document_type);

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
