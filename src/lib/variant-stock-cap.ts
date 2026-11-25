import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * Stock del padre (tope) y total ya cargado en sus variantes, dentro de una
 * sucursal. `cap === null` significa que no hay fila de `product_stock` para
 * ese tenant; las RPC de alta/edición ya validan la pertenencia, así que en ese
 * caso se omite el chequeo en vez de inventar un producto ajeno.
 */
export async function readVariantStockCap(
  productId: string,
  tenantId: string
): Promise<{ cap: number | null; total: number } | { error: string }> {
  const [parent, variants] = await Promise.all([
    supabaseAdmin
      .from('product_stock')
      .select('stock')
      .eq('product_id', productId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from('product_variants')
      .select('variant_stock!inner(stock)')
      .eq('product_id', productId)
      .eq('variant_stock.tenant_id', tenantId),
  ]);

  if (parent.error || variants.error) {
    return { error: 'No se pudo validar el stock disponible de las variantes' };
  }

  const total = (variants.data ?? []).reduce((sum, row) => {
    const stocks = (row.variant_stock ?? []) as Array<Record<string, unknown>>;
    return sum + stocks.reduce((inner, stock) => inner + (Number(stock.stock) || 0), 0);
  }, 0);

  return {
    cap: parent.data ? (Number((parent.data as Record<string, unknown>).stock) || 0) : null,
    total,
  };
}

export function variantStockCapError(cap: number, candidateTotal: number): string {
  return `El total de variantes (${candidateTotal}) no puede superar el stock del producto principal (${cap})`;
}
