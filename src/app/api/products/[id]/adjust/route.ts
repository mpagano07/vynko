import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { quantity, reason, notes } = body as {
    quantity: number;
    reason: 'damaged' | 'lost' | 'stolen' | 'expired' | 'found' | 'correction';
    notes?: string;
  };

  if (!quantity || typeof quantity !== 'number') {
    return NextResponse.json({ error: 'La cantidad es requerida' }, { status: 400 });
  }

  if (!reason) {
    return NextResponse.json({ error: 'El motivo es requerido' }, { status: 400 });
  }

  const { data: product, error: prodError } = await supabaseAdmin
    .from('products')
    .select('id, name')
    .eq('id', id)
    .single();

  if (prodError || !product) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  const { data: stockRow } = await supabaseAdmin
    .from('product_stock')
    .select('stock')
    .eq('product_id', id)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle();

  const currentStock = (stockRow as any)?.stock ?? 0;
  const newStock = currentStock + quantity;
  if (newStock < 0) {
    return NextResponse.json({ error: 'El stock no puede ser negativo' }, { status: 400 });
  }

  const { error: updateError } = await supabaseAdmin
    .from('product_stock')
    .update({ stock: newStock, updated_at: new Date().toISOString() })
    .eq('product_id', id)
    .eq('tenant_id', auth.tenantId);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  let historyWarning: string | undefined;
  const { error: histError } = await supabaseAdmin
    .from('stock_history')
    .insert({
      tenant_id: auth.tenantId,
      product_id: id,
      quantity,
      type: 'adjustment',
      reason: `${reason}${notes ? ': ' + notes : ''}`,
      created_by: auth.userId,
    });

  if (histError) {
    console.error('stock_history insert error:', JSON.stringify(histError));
    historyWarning = 'El stock se actualizó pero no se pudo registrar en el historial. ' + histError.message;
  }

  return NextResponse.json({
    success: true,
    warning: historyWarning,
    previousStock: currentStock,
    newStock,
    adjustment: quantity,
    reason,
    notes,
  });
}
