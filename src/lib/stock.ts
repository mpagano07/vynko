export interface StockMovement {
  tenant_id: string;
  product_id: string;
  quantity: number;
  type: string;
  reason: string;
  created_by: string;
}

export type StockAdjustmentResult =
  | { ok: true; newStock: number }
  | { ok: false; error: string };

/**
 * Applies a signed quantity adjustment to the current stock.
 * The resulting stock can never be negative.
 */
export function adjustStock(currentStock: number, quantity: number): StockAdjustmentResult {
  const newStock = currentStock + quantity;
  if (newStock < 0) {
    return { ok: false, error: 'El stock no puede ser negativo' };
  }
  return { ok: true, newStock };
}

export type StockSaleResult =
  | { ok: true; newStock: number }
  | { ok: false; error: string };

/**
 * Reduces stock after a sale. Returns an error when there is not enough stock.
 */
export function reduceStockForSale(
  currentStock: number,
  quantity: number,
  productName: string
): StockSaleResult {
  if (quantity > currentStock) {
    return {
      ok: false,
      error: `Stock insuficiente para "${productName}" (disponible: ${currentStock})`,
    };
  }
  return { ok: true, newStock: currentStock - quantity };
}

export function buildStockMovement(params: {
  tenantId: string;
  productId: string;
  quantity: number;
  type: string;
  reason: string;
  createdBy: string;
}): StockMovement {
  return {
    tenant_id: params.tenantId,
    product_id: params.productId,
    quantity: params.quantity,
    type: params.type,
    reason: params.reason,
    created_by: params.createdBy,
  };
}
