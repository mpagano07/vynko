export type StockFilter = 'all' | 'critical' | 'low' | 'normal';

export interface SearchableProduct {
  name?: string;
  sku?: string;
  barcode?: string;
  category_id?: string;
  stock?: number;
  min_stock?: number;
}

export interface ProductFilters {
  searchTerm?: string;
  categoryId?: string;
  stockFilter?: StockFilter;
}

export function matchesSearch(product: SearchableProduct, searchTerm: string): boolean {
  const term = searchTerm.toLowerCase();
  return Boolean(
    product.name?.toLowerCase().includes(term) ||
      product.sku?.toLowerCase().includes(term) ||
      product.barcode?.toLowerCase().includes(term)
  );
}

export function matchesStockLevel(
  stock: number,
  minStock: number,
  filter: StockFilter
): boolean {
  if (filter === 'critical') return stock <= minStock;
  if (filter === 'low') return stock > minStock && stock <= minStock * 1.5;
  if (filter === 'normal') return stock > minStock * 1.5;
  return true;
}

export function filterProducts<T extends SearchableProduct>(
  products: T[],
  filters: ProductFilters = {}
): T[] {
  const { searchTerm = '', categoryId = 'all', stockFilter = 'all' } = filters;

  return products.filter((product) => {
    const matchesCategory = categoryId === 'all' || product.category_id === categoryId;
    const matchesStock = matchesStockLevel(
      product.stock ?? 0,
      product.min_stock ?? 0,
      stockFilter
    );
    return matchesCategory && matchesStock && matchesSearch(product, searchTerm);
  });
}
