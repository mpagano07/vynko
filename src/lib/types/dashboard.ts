export interface CriticalProduct {
  id: string;
  name: string;
  stock: number;
  min_stock: number;
}

export interface PendingOrderItem {
  product_id: string | null;
  product_name: string;
  quantity_ordered: number;
  quantity_received: number;
  quantity_pending: number;
}

export interface PendingOrder {
  id: string;
  status: string;
  expected_date: string | null;
  created_at: string;
  supplier_name: string;
  tenant_name?: string;
  items: PendingOrderItem[];
}