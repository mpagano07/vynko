import { describe, expect, it } from 'vitest';
import { effectiveLocation, locationParts } from '@/lib/product-location';
import type { Product } from '@/lib/types/product';
import type { ProductVariant } from '@/lib/types/variant';

const product: Product = {
  id: 'p-1',
  name: 'Remera',
  price: 100,
  deposito: 'Depósito central',
  pasillo: 'A',
  estanteria: '1',
};

const variant = (overrides: Partial<ProductVariant> = {}): ProductVariant => ({
  id: 'v-1',
  product_id: product.id,
  sku: 'V-1',
  barcode: null,
  label: 'Rojo',
  price: 100,
  cost: null,
  active: true,
  ...overrides,
});

describe('locationParts', () => {
  it('descarta valores vacíos y no devuelve duplicados entre variantes', () => {
    expect(locationParts({ deposito: ' Central ', pasillo: '', estanteria: '2' })).toEqual(['Central', '2']);
  });
});

describe('effectiveLocation', () => {
  it('usa la ubicación de las variantes cuando alguna la tiene', () => {
    expect(effectiveLocation(product, [
      variant({ deposito: 'Depósito norte', pasillo: 'B', estanteria: '3' }),
      variant({ id: 'v-2', deposito: 'Depósito norte', pasillo: 'B', estanteria: '4' }),
    ])).toEqual(['Depósito norte', 'B', '3', '4']);
  });

  it('cae a la ubicación del padre si las variantes no tienen ubicación', () => {
    expect(effectiveLocation(product, [variant()])).toEqual(['Depósito central', 'A', '1']);
    expect(effectiveLocation(product, [])).toEqual(['Depósito central', 'A', '1']);
  });
});
