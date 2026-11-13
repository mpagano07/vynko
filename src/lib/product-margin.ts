/**
 * Cálculos de margen del formulario de producto.
 *
 * El margen se mide sobre el COSTO, no sobre el precio de venta: un producto
 * que cuesta 100 y se vende a 140 tiene 40% de margen. Es la convención que ya
 * usaba la lista de productos y la que espera el comerciante cuando dice
 * "le cargo 40%".
 *
 * Viven en un módulo propio para poder testearlos sin montar la página y para
 * que el modal extraído (`product-form-modal`) y la tabla usen la misma cuenta.
 */

/** Porcentaje de margen sobre el costo. Devuelve 0 si el costo no es positivo. */
export function marginPercent(price: number, cost: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(cost) || cost <= 0) return 0;
  return ((price - cost) / cost) * 100;
}

/**
 * Precio de venta que deja el margen pedido sobre el costo, redondeado al peso.
 * El margen puede ser negativo (vender bajo costo).
 */
export function priceFromMargin(cost: number, margin: number): number {
  return Math.round(cost * (1 + margin / 100));
}

/**
 * Normaliza lo que el usuario tipea en el campo de margen: acepta "+40,5%",
 * "40.5" o "40 %". Devuelve `null` si no hay un número válido, para que el
 * formulario no pise el precio con un `NaN`.
 */
export function parseMarginInput(raw: string): number | null {
  const normalized = raw.replace(/[%+\s]/g, '').replace(',', '.');
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
