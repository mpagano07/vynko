import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/types/product';
import { formFromProduct } from './variant-manager-modal';

const parent: Product = {
  id: 'padre-1',
  name: 'Remera',
  sku: 'REM-001',
  barcode: '7791234567890',
  category_id: 'cat-1',
  cost: 10,
  price: 25,
  stock: 12,
  min_stock: 2,
  max_stock: 40,
  deposito: 'Depósito Central',
  pasillo: 'A',
  estanteria: '3',
  is_active: true,
};

describe('formFromProduct', () => {
  it('precarga el formulario de variante con los valores visibles del producto principal', () => {
    expect(formFromProduct(parent)).toEqual({
      label: '',
      sku: 'REM-001',
      barcode: '7791234567890',
      price: '25',
      cost: '10',
      stock: '12',
      min_stock: '2',
      max_stock: '40',
      deposito: 'Depósito Central',
      pasillo: 'A',
      estanteria: '3',
      category_id: 'cat-1',
    });
  });

  it('usa valores vacíos o cero cuando el padre no los tiene cargados', () => {
    expect(formFromProduct({ id: 'padre-2', name: 'Caño', price: 0 })).toEqual({
      label: '',
      sku: '',
      barcode: '',
      price: '0',
      cost: '',
      stock: '0',
      min_stock: '0',
      max_stock: '0',
      deposito: '',
      pasillo: '',
      estanteria: '',
      category_id: '',
    });
  });
});
