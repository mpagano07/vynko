export type TransferStatus = 'pending' | 'in_transit' | 'received';

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  pending: 'Pendiente',
  in_transit: 'En tránsito',
  received: 'Recibida',
};

export interface StockTransfer {
  id: string;
  from_tenant_id: string;
  to_tenant_id: string;
  status: TransferStatus;
  notes?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  received_at?: string;
  items?: StockTransferItem[];
  from_tenant_name?: string;
  to_tenant_name?: string;
  created_by_name?: string;
}

export interface StockTransferItem {
  id: string;
  transfer_id: string;
  product_id: string;
  quantity: number;
  created_at: string;
  product_name?: string;
}

export interface TransferItem {
  id: string;
  product_id: string;
  product_name?: string;
  quantity: number;
}

export interface Transfer {
  id: string;
  from_tenant_id: string;
  to_tenant_id: string;
  from_tenant_name: string;
  to_tenant_name: string;
  status: TransferStatus;
  notes?: string;
  created_at: string;
  updated_at: string;
  received_at?: string;
  created_by_name: string;
  items: TransferItem[];
}
