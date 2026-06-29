export type IvaCondition =
  | 'responsable_inscripto'
  | 'monotributista'
  | 'consumidor_final'
  | 'sujeto_exento'
  | 'responsable_no_inscripto';

export type InvoiceType = 'A' | 'B' | 'C' | 'NC_A' | 'NC_B' | 'NC_C' | 'ND_A' | 'ND_B' | 'ND_C';

export type InvoiceStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type DocumentType = 'DNI' | 'CUIL' | 'CUIT' | 'Pasaporte' | 'CE';

export interface ElectronicInvoice {
  id: string;
  tenant_id: string;
  sale_id?: string;
  invoice_number: number;
  punto_venta: number;
  invoice_type: InvoiceType;
  cuit_emisor: string;
  cuit_receptor?: string;
  customer_id?: string;
  customer_name: string;
  document_type: DocumentType;
  document_number?: string;
  iva_condition: IvaCondition;
  total_cents: number;
  net_cents: number;
  iva_cents: number;
  iva_percentage: number;
  other_taxes_cents: number;
  cae?: string;
  cae_due_date?: string;
  afip_result?: string;
  afip_response?: Record<string, unknown>;
  status: InvoiceStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  items?: InvoiceItem[];
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id?: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  subtotal_cents: number;
  iva_percentage: number;
  iva_cents: number;
}

export interface InvoiceSequence {
  id: string;
  tenant_id: string;
  punto_venta: number;
  invoice_type: InvoiceType;
  next_number: number;
}

export interface AfipConfig {
  cuit: string;
  punto_venta: number;
  iva_condition: IvaCondition;
  ingresos_brutos?: string;
  inicio_actividades?: string;
}

export interface AfipInvoiceRequest {
  sale_id?: string;
  invoice_type: InvoiceType;
  customer_id?: string;
  customer_name: string;
  document_type: DocumentType;
  document_number: string;
  iva_condition: IvaCondition;
  cuit_receptor?: string;
  items: {
    product_id?: string;
    description: string;
    quantity: number;
    unit_price_cents: number;
    iva_percentage?: number;
  }[];
}

export interface AfipCaeResponse {
  cae: string;
  cae_due_date: string;
  invoice_number: number;
  result: 'A' | 'R' | 'O';
  observations?: { code: number; msg: string }[];
  errors?: { code: number; msg: string }[];
}

export const IVA_CONDITION_LABELS: Record<IvaCondition, string> = {
  responsable_inscripto: 'Responsable Inscripto',
  monotributista: 'Monotributista',
  consumidor_final: 'Consumidor Final',
  sujeto_exento: 'Sujeto Exento',
  responsable_no_inscripto: 'Responsable No Inscripto',
};

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  A: 'Factura A',
  B: 'Factura B',
  C: 'Factura C',
  NC_A: 'Nota de Crédito A',
  NC_B: 'Nota de Crédito B',
  NC_C: 'Nota de Crédito C',
  ND_A: 'Nota de Débito A',
  ND_B: 'Nota de Débito B',
  ND_C: 'Nota de Débito C',
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  DNI: 'DNI',
  CUIL: 'CUIL',
  CUIT: 'CUIT',
  Pasaporte: 'Pasaporte',
  CE: 'Cédula de Identidad',
};
