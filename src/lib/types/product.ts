export interface Product {
  id: string;
  tenant_id: string;
  category_id?: string;
  sku?: string;
  barcode?: string;
  name: string;
  description?: string;
  images?: string[];
  unit?: string;
  cost?: number;
  price: number;
  stock?: number;
  min_stock?: number;
  max_stock?: number;
  is_active?: boolean;
  attributes?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}
