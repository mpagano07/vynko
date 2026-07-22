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
  remito_salida: 'Remito de Salida',
  remito_ingreso: 'Remito de Ingreso',
  presupuesto: 'Presupuesto',
  orden_compra: 'Orden de Compra',
  orden_venta: 'Orden de Venta',
};

export const DOCUMENT_TYPE_ICONS: Record<DocumentType, string> = {
  remito_salida: '📤',
  remito_ingreso: '📥',
  presupuesto: '📋',
  orden_compra: '🛒',
  orden_venta: '💰',
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

export const DOCUMENT_STATUS_COLORS: Record<DocumentStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export const VALID_STATUSES_PER_TYPE: Record<DocumentType, DocumentStatus[]> = {
  remito_salida: ['pending', 'completed', 'cancelled'],
  remito_ingreso: ['pending', 'completed', 'cancelled'],
  presupuesto: ['pending', 'approved', 'rejected', 'completed'],
  orden_compra: ['pending', 'approved', 'completed', 'cancelled'],
  orden_venta: ['pending', 'approved', 'completed', 'cancelled'],
};
