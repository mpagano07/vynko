export interface Sale {
  id: string;
  tenant_id: string;
  customer_id?: string;
  customer_name?: string;
  total_cents: number;
  payment_method: string;
  status: 'draft' | 'pending' | 'completed' | 'cancelled';
  notes?: string;
  sold_by?: string;
  created_at: string;
  items: SaleItem[];
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  product_name?: string;
  quantity: number;
  unit_price_cents: number;
  subtotal_cents: number;
}

export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  cuit?: string;
  iva_condition?: string;
  document_type?: string;
  document_number?: string;
}
