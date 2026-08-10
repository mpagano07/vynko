import { describe, expect, it } from 'vitest';
import { adjustStock, reduceStockForSale, buildStockMovement } from './stock';

describe('adjustStock', () => {
  it('ingresa stock sumando la cantidad', () => {
    expect(adjustStock(10, 5)).toEqual({ ok: true, newStock: 15 });
  });

  it('reduce stock restando la cantidad', () => {
    expect(adjustStock(10, -4)).toEqual({ ok: true, newStock: 6 });
  });

  it('calcula el stock resultante exacto', () => {
    expect(adjustStock(0, 0)).toEqual({ ok: true, newStock: 0 });
    expect(adjustStock(100, -100)).toEqual({ ok: true, newStock: 0 });
  });

  it('no permite stock negativo', () => {
    expect(adjustStock(10, -11)).toEqual({ ok: false, error: 'El stock no puede ser negativo' });
  });

  it('permite llegar a cero pero no por debajo', () => {
    expect(adjustStock(10, -10)).toEqual({ ok: true, newStock: 0 });
    expect(adjustStock(0, -1)).toEqual({ ok: false, error: 'El stock no puede ser negativo' });
  });
});

describe('reduceStockForSale', () => {
  it('reduce stock al vender', () => {
    expect(reduceStockForSale(20, 5, 'Producto')).toEqual({ ok: true, newStock: 15 });
  });

  it('actualiza stock a la cantidad correcta tras la venta', () => {
    expect(reduceStockForSale(8, 3, 'Producto')).toEqual({ ok: true, newStock: 5 });
  });

  it('permite vender el stock exacto (queda en cero)', () => {
    expect(reduceStockForSale(5, 5, 'Producto')).toEqual({ ok: true, newStock: 0 });
  });

  it('rechaza venta sin stock suficiente', () => {
    const result = reduceStockForSale(3, 5, 'Coca');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Stock insuficiente para "Coca" (disponible: 3)');
    }
  });

  it('rechaza venta con stock en cero', () => {
    expect(reduceStockForSale(0, 1, 'Prod').ok).toBe(false);
  });
});

describe('buildStockMovement', () => {
  it('construye un movimiento de ingreso', () => {
    const movement = buildStockMovement({
      tenantId: 'tenant-1',
      productId: 'product-1',
      quantity: 12,
      type: 'in',
      reason: 'Compra',
      createdBy: 'user-1',
    });
    expect(movement).toEqual({
      tenant_id: 'tenant-1',
      product_id: 'product-1',
      quantity: 12,
      type: 'in',
      reason: 'Compra',
      created_by: 'user-1',
    });
  });

  it('construye un movimiento de salida con cantidad negativa', () => {
    const movement = buildStockMovement({
      tenantId: 'tenant-1',
      productId: 'product-1',
      quantity: -3,
      type: 'out',
      reason: 'Venta',
      createdBy: 'user-1',
    });
    expect(movement.quantity).toBe(-3);
    expect(movement.type).toBe('out');
  });

  it('incluye el motivo y el usuario que lo registró', () => {
    const movement = buildStockMovement({
      tenantId: 'tenant-1',
      productId: 'product-1',
      quantity: 2,
      type: 'adjustment',
      reason: 'correction: merma',
      createdBy: 'user-1',
    });
    expect(movement.reason).toBe('correction: merma');
    expect(movement.created_by).toBe('user-1');
  });
});
