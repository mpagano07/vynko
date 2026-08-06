export interface Product {
  id: string;
  category_id?: string;
  sku?: string;
  barcode?: string;
  name: string;
  description?: string;
  image_url?: string;
  images?: string[];
  unit?: string;
  cost?: number;
  price: number;
  stock?: number;
  min_stock?: number;
  max_stock?: number;
  deposito?: string;
  pasillo?: string;
  estanteria?: string;
  is_active?: boolean;
  attributes?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface ProductStock {
  id: string;
  product_id: string;
  tenant_id: string;
  stock: number;
  min_stock: number;
  max_stock: number;
  created_at?: string;
  updated_at?: string;
}
