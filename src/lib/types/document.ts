export type DocumentType =
  | 'remito_salida'
  | 'remito_ingreso'
  | 'presupuesto'
  | 'orden_compra'
  | 'orden_venta';

export type DocumentStatus = 'pending' | 'approved' | 'rejected' | 'completed' | 'cancelled';

export interface CommercialDocument {
  id: string;
  tenant_id: string;
  document_type: DocumentType;
  document_number: number;
  sale_id?: string;
  purchase_order_id?: string;
  customer_id?: string;
  customer_name: string;
  supplier_name?: string;
  notes?: string;
  total_cents: number;
  status: DocumentStatus;
  valid_until?: string;
  delivery_date?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  items?: CommercialDocumentItem[];
}

export interface CommercialDocumentItem {
  id: string;
  document_id: string;
  product_id?: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  subtotal_cents: number;
  created_at: string;
}

export interface CommercialDocumentSequence {
  id: string;
  tenant_id: string;
  document_type: DocumentType;
  next_number: number;
  created_at: string;
  updated_at: string;
}

export interface CreateDocumentRequest {
  document_type: DocumentType;
  sale_id?: string;
  purchase_order_id?: string;
  customer_id?: string;
  customer_name: string;
  supplier_name?: string;
  notes?: string;
  valid_until?: string;
  delivery_date?: string;
  items: {
    product_id?: string;
    description: string;
    quantity: number;
    unit_price_cents: number;
  }[];
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  remito_ingreso: 'Remito de Ingreso',
  remito_salida: 'Remito de Salida',
  presupuesto: 'Presupuesto',
  orden_compra: 'Orden de Compra',
  orden_venta: 'Orden de Venta',
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

export const VALID_STATUSES_PER_TYPE: Record<DocumentType, DocumentStatus[]> = {
  remito_salida: ['pending', 'completed', 'cancelled'],
  remito_ingreso: ['pending', 'completed', 'cancelled'],
  presupuesto: ['pending', 'approved', 'rejected', 'completed'],
  orden_compra: ['pending', 'approved', 'completed', 'cancelled'],
  orden_venta: ['pending', 'approved', 'completed', 'cancelled'],
};
