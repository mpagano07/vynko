import type { Product } from '@/lib/types/product';
import type { ProductVariant } from '@/lib/types/variant';

type Located = {
  deposito?: string | null;
  pasillo?: string | null;
  estanteria?: string | null;
};

/** Partes no vacías de la ubicación, en el orden en que se muestran siempre. */
export function locationParts(item: Located): string[] {
  return [item.deposito, item.pasillo, item.estanteria]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.trim());
}

/**
 * Un producto con variantes se ubica por sus variantes: el `product_stock` del
 * padre es sólo informativo en ese caso. Si ninguna variante tiene ubicación,
 * se mantiene la del padre para no dejar la celda vacía.
 */
export function effectiveLocation(product: Product, variants: ProductVariant[]): string[] {
  const fromVariants = Array.from(new Set(variants.flatMap((variant) => locationParts(variant))));
  return fromVariants.length > 0 ? fromVariants : locationParts(product);
}
