import { describe, expect, it } from 'vitest';
import { groupSellablesForDisplay, type DisplaySellable } from './sales-display';

const variant = (overrides: Partial<DisplaySellable> = {}): DisplaySellable => ({
  id: 'v1',
  kind: 'variant',
  product_id: 'p1',
  variant_id: 'v1',
  name: 'Remera · Rojo',
  productName: 'Remera',
  variantLabel: 'Rojo',
  stock: 0,
  ...overrides,
});

const simple = (): DisplaySellable => ({
  id: 'p2',
  kind: 'product',
  product_id: 'p2',
  variant_id: null,
  name: 'Cuaderno',
  productName: 'Cuaderno',
  variantLabel: null,
  stock: 5,
});

describe('groupSellablesForDisplay', () => {
  it('muestra una sola tarjeta por producto con variantes', () => {
    const rojo = variant({ id: 'v1', stock: 2 });
    const azul = variant({ id: 'v2', variant_id: 'v2', name: 'Remera · Azul', variantLabel: 'Azul', stock: 1 });
    const all = new Map([['p1', [rojo, azul]]]);

    const result = groupSellablesForDisplay([rojo, azul], all);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'Remera',
      variantLabel: null,
      variantCount: 2,
      stock: 2,
    });
  });

  it('representa al padre con una variante con stock aunque la buscada no tenga', () => {
    const sinStock = variant({ id: 'v1', stock: 0 });
    const conStock = variant({ id: 'v2', variant_id: 'v2', variantLabel: 'Azul', stock: 3 });
    const all = new Map([['p1', [sinStock, conStock]]]);

    const result = groupSellablesForDisplay([sinStock], all);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'v2', stock: 3, variantCount: 2 });
  });

  it('no toca los productos simples', () => {
    const cuaderno = simple();
    const result = groupSellablesForDisplay([cuaderno], new Map());

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(cuaderno);
    expect(result[0].variantCount).toBeUndefined();
  });
});
