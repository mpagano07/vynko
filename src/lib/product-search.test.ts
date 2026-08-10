import { describe, expect, it } from 'vitest';
import { filterProducts, matchesSearch, matchesStockLevel } from './product-search';
import type { SearchableProduct } from './product-search';

const products: SearchableProduct[] = [
  { name: 'Coca Cola 1.5L', sku: 'COCA-1500', barcode: '7790001', category_id: 'cat-bebidas', stock: 50, min_stock: 10 },
  { name: 'Agua Mineral', sku: 'AGUA-500', barcode: '7790002', category_id: 'cat-bebidas', stock: 5, min_stock: 10 },
  { name: 'Galletitas', sku: 'GALL-01', barcode: '7790003', category_id: 'cat-comestibles', stock: 20, min_stock: 10 },
  { name: 'Detergente', sku: 'DETER-01', barcode: '7790004', category_id: 'cat-limpieza', stock: 30, min_stock: 10 },
];

describe('matchesSearch', () => {
  it('encuentra por nombre (case insensitive)', () => {
    expect(matchesSearch(products[0], 'coca')).toBe(true);
    expect(matchesSearch(products[0], 'COCA')).toBe(true);
  });

  it('encuentra por SKU', () => {
    expect(matchesSearch(products[1], 'agua-500')).toBe(true);
  });

  it('encuentra por código de barras', () => {
    expect(matchesSearch(products[2], '7790003')).toBe(true);
  });

  it('no encuentra cuando no hay coincidencia', () => {
    expect(matchesSearch(products[0], 'inexistente')).toBe(false);
  });

  it('maneja búsqueda vacía', () => {
    expect(matchesSearch(products[0], '')).toBe(true);
  });
});

describe('matchesStockLevel', () => {
  it('critical: stock menor o igual al mínimo', () => {
    expect(matchesStockLevel(10, 10, 'critical')).toBe(true);
    expect(matchesStockLevel(5, 10, 'critical')).toBe(true);
    expect(matchesStockLevel(11, 10, 'critical')).toBe(false);
  });

  it('low: stock entre mínimo y 1.5x del mínimo', () => {
    expect(matchesStockLevel(12, 10, 'low')).toBe(true);
    expect(matchesStockLevel(15, 10, 'low')).toBe(true);
    expect(matchesStockLevel(10, 10, 'low')).toBe(false);
    expect(matchesStockLevel(16, 10, 'low')).toBe(false);
  });

  it('normal: stock mayor a 1.5x del mínimo', () => {
    expect(matchesStockLevel(16, 10, 'normal')).toBe(true);
    expect(matchesStockLevel(15, 10, 'normal')).toBe(false);
  });

  it('all: siempre true', () => {
    expect(matchesStockLevel(0, 10, 'all')).toBe(true);
  });
});

describe('filterProducts', () => {
  it('devuelve todos sin filtros', () => {
    expect(filterProducts(products)).toHaveLength(4);
  });

  it('filtra por término de búsqueda', () => {
    const result = filterProducts(products, { searchTerm: 'coca' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Coca Cola 1.5L');
  });

  it('filtra por categoría', () => {
    const result = filterProducts(products, { categoryId: 'cat-bebidas' });
    expect(result).toHaveLength(2);
  });

  it('filtra por nivel de stock crítico', () => {
    const result = filterProducts(products, { stockFilter: 'critical' });
    expect(result.map((p) => p.name)).toEqual(['Agua Mineral']);
  });

  it('combina búsqueda + categoría + stock', () => {
    const result = filterProducts(products, {
      searchTerm: 'a',
      categoryId: 'cat-bebidas',
      stockFilter: 'all',
    });
    expect(result.map((p) => p.name)).toEqual(['Coca Cola 1.5L', 'Agua Mineral']);
  });
});
