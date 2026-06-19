import { supabaseAdmin } from './supabaseAdmin';

type NotificationType = 'stock_critical' | 'stock_low' | 'po_received' | 'po_cancelled' | 'collaborator_joined' | 'invitation_accepted' | 'system';

export async function createNotification(params: {
  tenantId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
}) {
  const { error } = await supabaseAdmin
    .from('notifications')
    .insert({
      tenant_id: params.tenantId,
      type: params.type,
      title: params.title,
      message: params.message,
      data: params.data || {},
    });

  if (error) console.error('Error creating notification:', error);
}

export async function checkAndNotifyStock(tenantId: string, productId: string) {
  const { data: product } = await supabaseAdmin
    .from('products')
    .select('name, stock, min_stock')
    .eq('id', productId)
    .single();

  if (!product) return;

  const stock = product.stock ?? 0;
  const min = product.min_stock ?? 0;

  if (stock <= min) {
    await createNotification({
      tenantId,
      type: 'stock_critical',
      title: 'Stock crítico',
      message: `"${product.name}" tiene solo ${stock} unidades (mínimo: ${min}).`,
      data: { product_id: productId, stock, min_stock: min },
    });
  } else if (stock <= min * 1.5) {
    await createNotification({
      tenantId,
      type: 'stock_low',
      title: 'Stock bajo',
      message: `"${product.name}" está por debajo del nivel recomendado (${stock} unidades).`,
      data: { product_id: productId, stock, min_stock: min },
    });
  }
}
