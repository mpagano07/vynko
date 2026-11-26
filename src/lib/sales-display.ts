/**
 * Shape mínimo que el POS necesita para agrupar variantes en una sola tarjeta.
 * `ProductOption` de `/sales` cumple esta interfaz.
 */
export interface DisplaySellable {
  id: string;
  kind: 'product' | 'variant';
  product_id: string;
  variant_id: string | null;
  name: string;
  productName: string;
  variantLabel: string | null;
  stock: number;
}

/**
 * El catálogo `sellable` trae una fila por variante. Para la grilla del POS
 * mostramos una sola tarjeta por producto padre: al tocarla se abre el
 * selector de variantes una única vez, en vez de repetir el mismo producto.
 *
 * `filtered` ya viene filtrado por la búsqueda; `allVariantsByParent` tiene
 * todas las variantes vendibles del catálogo para el contador y el selector.
 */
export function groupSellablesForDisplay<T extends DisplaySellable>(
  filtered: T[],
  allVariantsByParent: Map<string, T[]>
): (T & { variantCount?: number })[] {
  const matchingVariants = new Map<string, T[]>();
  for (const item of filtered) {
    if (item.kind !== 'variant') continue;
    const group = matchingVariants.get(item.product_id) ?? [];
    group.push(item);
    matchingVariants.set(item.product_id, group);
  }

  const seenParents = new Set<string>();
  const result: (T & { variantCount?: number })[] = [];
  for (const item of filtered) {
    if (item.kind === 'product') {
      result.push(item);
      continue;
    }
    if (seenParents.has(item.product_id)) continue;
    seenParents.add(item.product_id);

    const allVariants = allVariantsByParent.get(item.product_id) ?? [];
    const matching = matchingVariants.get(item.product_id) ?? [];
    // Preferimos una variante con stock y que coincida con la búsqueda para que
    // la tarjeta del padre no quede deshabilitada si otra sí tiene stock.
    const representative =
      matching.find((v) => v.stock > 0) ??
      allVariants.find((v) => v.stock > 0) ??
      item;

    result.push({
      ...representative,
      name: representative.productName,
      variantLabel: null,
      variantCount: allVariants.length,
    });
  }
  return result;
}
