import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { DocumentStatus } from '@/lib/types/document';

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

  const { data: document, error } = await supabaseAdmin
    .from('commercial_documents')
    .select('*, items:commercial_document_items(*)')
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .single();

  if (error) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
  return NextResponse.json(document);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { status, notes, valid_until, delivery_date } = body as {
    status?: DocumentStatus;
    notes?: string;
    valid_until?: string;
    delivery_date?: string;
  };

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

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;

  const { error } = await supabaseAdmin
    .from('commercial_documents')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
