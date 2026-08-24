import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { adjustStock, buildStockMovement } from '@/lib/stock';

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

  const currentStock = Number((stockRow as Record<string, unknown> | null)?.stock) || 0;
  const result = adjustStock(currentStock, quantity);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const newStock = result.newStock;

  const { error: updateError } = await supabaseAdmin
    .from('product_stock')
    .update({ stock: newStock, updated_at: new Date().toISOString() })
    .eq('product_id', id)
    .eq('tenant_id', auth.tenantId);

  if (updateError) { console.error('DB error:', updateError); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }

  let historyWarning: string | undefined;
  const movement = buildStockMovement({
    tenantId: auth.tenantId,
    productId: id,
    quantity,
    type: 'adjustment',
    reason: `${reason}${notes ? ': ' + notes : ''}`,
    createdBy: auth.userId,
  });
  const { error: histError } = await supabaseAdmin
    .from('stock_history')
    .insert(movement);

  if (histError) {
    console.error('stock_history insert error:', JSON.stringify(histError));
    historyWarning = 'El stock se actualizó pero no se pudo registrar en el historial.';
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
