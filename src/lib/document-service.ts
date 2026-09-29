import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { CreateDocumentRequest, DocumentStatus, DocumentType } from '@/lib/types/document';
import type { AuthInfo } from '@/lib/api-auth';
import { canManageTenant, getRoleInTenant } from '@/lib/membership-role';
import { trackEvent } from '@/lib/track-event';

export type DocumentResult<T = unknown> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidLike(value: string): boolean {
  return UUID_RE.test(value);
}

export async function listDocuments(
  auth: AuthInfo,
  filters: { documentType: string | null; purchaseOrderId: string | null }
): Promise<DocumentResult> {
  const { documentType, purchaseOrderId } = filters;

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

  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }
  return { ok: true, data: documents ?? [], status: 200 };
}

export async function createDocument(
  auth: AuthInfo,
  body: CreateDocumentRequest & { sale_id?: string; purchase_order_id?: string }
): Promise<DocumentResult> {
  try {
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
    } = body;

    if (!document_type || !customer_name || !items || !Array.isArray(items) || items.length === 0) {
      return { ok: false, error: 'Faltan datos requeridos (tipo documento, cliente, items)', status: 400 };
    }

    const validTypes: DocumentType[] = ['remito_salida', 'remito_ingreso', 'presupuesto', 'orden_compra', 'orden_venta'];
    if (!validTypes.includes(document_type)) {
      return { ok: false, error: 'Tipo de documento inválido', status: 400 };
    }

    // Las referencias opcionales vienen del body: se validan contra el tenant
    // del usuario para que un documento no pueda quedar vinculado (ni delatar
    // la existencia de) una venta, orden de compra o cliente de otra sucursal.
    const foreignRefs: Array<{ table: string; column: string; value: unknown; label: string }> = [
      { table: 'sales', column: 'sale_id', value: sale_id, label: 'La venta' },
      { table: 'purchase_orders', column: 'purchase_order_id', value: purchase_order_id, label: 'La orden de compra' },
      { table: 'customers', column: 'customer_id', value: customer_id, label: 'El cliente' },
    ];

    for (const ref of foreignRefs) {
      if (ref.value === undefined || ref.value === null || ref.value === '') continue;
      if (typeof ref.value !== 'string' || !isUuidLike(ref.value)) {
        return { ok: false, error: `${ref.label} no es válida`, status: 400 };
      }
      const { data: found } = await supabaseAdmin
        .from(ref.table)
        .select('id')
        .eq('id', ref.value)
        .eq('tenant_id', auth.tenantId)
        .maybeSingle();
      if (!found) {
        return { ok: false, error: `${ref.label} no pertenece a tu sucursal`, status: 400 };
      }
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
          .upsert(
            {
              tenant_id: auth.tenantId,
              document_type,
              next_number: candidate,
            },
            { onConflict: 'tenant_id,document_type' }
          );
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
      return { ok: false, error: 'No se pudo generar el número de documento. Intentá de nuevo.', status: 409 };
    }

    const documentItems = items.map((item) => ({
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
      console.error('DB error:', itemsError);
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }

    const { data: fullDocument } = await supabaseAdmin
      .from('commercial_documents')
      .select('*, items:commercial_document_items(*)')
      .eq('id', document.id)
      .single();

    await trackEvent({
      type: 'document_created',
      userId: auth.userId,
      tenantId: auth.tenantId,
      metadata: {
        documentId: document.id,
        documentType: document_type,
        itemCount: documentItems.length,
      },
    });

    return { ok: true, data: fullDocument, status: 201 };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al crear documento';
    return { ok: false, error: message, status: 400 };
  }
}

export async function getDocument(auth: AuthInfo, id: string): Promise<DocumentResult> {
  const { data: document, error } = await supabaseAdmin
    .from('commercial_documents')
    .select('*, items:commercial_document_items(*)')
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .single();

  if (error) return { ok: false, error: 'Documento no encontrado', status: 404 };
  return { ok: true, data: document, status: 200 };
}

export async function updateDocument(
  auth: AuthInfo,
  id: string,
  body: { status?: DocumentStatus; notes?: string; valid_until?: string; delivery_date?: string }
): Promise<DocumentResult> {
  // Cambiar el estado de un documento comercial (anular, entregar, facturar) es
  // una acción administrativa, no operativa: se limita a owner/manager.
  if (!(await canManageTenant(await getRoleInTenant(auth.userId, auth.tenantId)))) {
    return {
      ok: false,
      error: 'Sólo el dueño o un administrador pueden modificar documentos',
      status: 403,
    };
  }

  const { status, notes, valid_until, delivery_date } = body;

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (status !== undefined) updateData.status = status;
  if (notes !== undefined) updateData.notes = notes;
  if (valid_until !== undefined) updateData.valid_until = valid_until;
  if (delivery_date !== undefined) updateData.delivery_date = delivery_date;

  const { data, error } = await supabaseAdmin
    .from('commercial_documents')
    .update(updateData)
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .select()
    .single();

  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }
  return { ok: true, data, status: 200 };
}

export async function deleteDocument(auth: AuthInfo, id: string): Promise<DocumentResult> {
  if (!(await canManageTenant(await getRoleInTenant(auth.userId, auth.tenantId)))) {
    return {
      ok: false,
      error: 'Sólo el dueño o un administrador pueden eliminar documentos',
      status: 403,
    };
  }

  const { error } = await supabaseAdmin
    .from('commercial_documents')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId);

  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }
  return { ok: true, data: { success: true }, status: 200 };
}