/**
 * Modelo de productos con variantes.
 *
 * Los productos simples siguen siendo filas de `products` + `product_stock`.
 * Las variantes son filas reales en `product_variants` con stock propio en
 * `variant_stock`; los atributos son tablas relacionales, no un JSONB.
 */

export interface ProductAttribute {
  id: string;
  name: string;
  values?: ProductAttributeValue[];
}

export interface ProductAttributeValue {
  id: string;
  attribute_id: string;
  value: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  sku: string;
  barcode: string | null;
  label: string;
  price: number;
  cost: number | null;
  active: boolean;
  valueIds?: string[];
  values?: ProductAttributeValue[];
  stock?: number;
  min_stock?: number;
  max_stock?: number;
  deposito?: string | null;
  pasillo?: string | null;
  estanteria?: string | null;
  category_id?: string | null;
}

/**
 * Unidad comercializable: la abstraccion que usa el POS, el carrito, las
 * compras y los documentos. `variantId` ausente significa producto simple.
 */
export interface SellableItem {
  /** `product` para productos simples, `variant` para variantes. */
  kind: 'product' | 'variant';
  id: string;
  productId: string;
  variantId?: string;
  sku: string;
  barcode: string | null;
  name: string;
  variantLabel: string | null;
  description: string | null;
  price: number;
  cost: number | null;
  stock: number;
  /** Etiqueta completa para listados y tickets. */
  displayName: string;
}

export function sellableDisplayName(name: string, variantLabel?: string | null): string {
  return variantLabel ? `${name} · ${variantLabel}` : name;
}

export function toSellableItem(params: {
  productId: string;
  name: string;
  description?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price: number;
  cost?: number | null;
  stock: number;
  variant?: {
    id: string;
    sku: string;
    barcode: string | null;
    label: string;
    price: number;
    cost: number | null;
    stock: number;
  } | null;
}): SellableItem {
  if (!params.variant) {
    return {
      kind: 'product',
      id: params.productId,
      productId: params.productId,
      sku: params.sku ?? '',
      barcode: params.barcode ?? null,
      name: params.name,
      variantLabel: null,
      description: params.description ?? null,
      price: params.price,
      cost: params.cost ?? null,
      stock: params.stock,
      displayName: sellableDisplayName(params.name),
    };
  }
  return {
    kind: 'variant',
    id: params.variant.id,
    productId: params.productId,
    variantId: params.variant.id,
    sku: params.variant.sku || params.sku || '',
    barcode: params.variant.barcode ?? params.barcode ?? null,
    name: params.name,
    variantLabel: params.variant.label,
    description: params.description ?? null,
    price: params.variant.price,
    cost: params.variant.cost,
    stock: params.variant.stock,
    displayName: sellableDisplayName(params.name, params.variant.label),
  };
}
