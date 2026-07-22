export interface Supplier {
  id: string;
  tenant_id: string;
  name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PurchaseOrder {
  id: string;
  tenant_id: string;
  supplier_id: string;
  supplier_name?: string;
  status: 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';
  total_cents: number;
  expected_date?: string;
  received_date?: string;
  notes?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  items: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: string;
  product_name?: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost_cents: number;
}
