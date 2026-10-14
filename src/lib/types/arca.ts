export type ArcaEnvironment = 'homologacion' | 'produccion';

export type ArcaConcept = 1 | 2 | 3; // 1: Productos, 2: Servicios, 3: Productos y Servicios

export interface ArcaConfig {
  id: string;
  tenant_id: string;
  cuit: string;
  punto_venta: number;
  environment: ArcaEnvironment;
  concept: ArcaConcept;
  has_cert: boolean;
  has_key: boolean;
  is_active: boolean;
  is_sandbox?: boolean;
  last_tested_at?: string;
  last_error?: string;
}

export type ArcaVoucherType =
  | 1 // Factura A
  | 2 // Nota de Débito A
  | 3 // Nota de Crédito A
  | 6 // Factura B
  | 7 // Nota de Débito B
  | 8 // Nota de Crédito B
  | 11 // Factura C
  | 12 // Nota de Débito C
  | 13; // Nota de Crédito C

export const VOUCHER_TYPE_NAMES: Record<ArcaVoucherType, string> = {
  1: 'Factura A',
  2: 'Nota de Débito A',
  3: 'Nota de Crédito A',
  6: 'Factura B',
  7: 'Nota de Débito B',
  8: 'Nota de Crédito B',
  11: 'Factura C',
  12: 'Nota de Débito C',
  13: 'Nota de Crédito C',
};

export const VOUCHER_TYPE_CODES: Record<string, ArcaVoucherType> = {
  A: 1,
  ND_A: 2,
  NC_A: 3,
  B: 6,
  ND_B: 7,
  NC_B: 8,
  C: 11,
  ND_C: 12,
  NC_C: 13,
};

export const CODE_TO_INVOICE_TYPE: Record<ArcaVoucherType, string> = {
  1: 'A',
  2: 'ND_A',
  3: 'NC_A',
  6: 'B',
  7: 'ND_B',
  8: 'NC_B',
  11: 'C',
  12: 'ND_C',
  13: 'NC_C',
};

export type ArcaDocType =
  | 80 // CUIT
  | 86 // CUIL
  | 96 // DNI
  | 99; // Sin identificar / Consumidor Final

export const DOC_TYPE_CODES: Record<string, ArcaDocType> = {
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  ConsumidorFinal: 99,
};

// Alícuotas de IVA según tabla de ARCA / AFIP
export type ArcaIvaRateId =
  | 3 // 0%
  | 4 // 10.5%
  | 5 // 21%
  | 6 // 27%
  | 8 // 5%
  | 9; // 2.5%

export const IVA_PERCENTAGES: Record<ArcaIvaRateId, number> = {
  3: 0,
  4: 10.5,
  5: 21,
  6: 27,
  8: 5,
  9: 2.5,
};

export const PERCENTAGE_TO_IVA_ID: Record<number, ArcaIvaRateId> = {
  0: 3,
  10.5: 4,
  21: 5,
  27: 6,
  5: 8,
  2.5: 9,
};

// IDs de "Condición frente al IVA del receptor" (WSFEv1, CondicionIVAReceptorId).
// Obligatorio desde la RG 5616; mapea la condición guardada en la app al código
// que espera ARCA. Valores: 1 = Responsable Inscripto, 4 = Exento,
// 5 = Consumidor Final, 6 = Monotributo.
export const CONDICION_IVA_RECEPTOR_ID: Record<string, number> = {
  responsable_inscripto: 1,
  sujeto_exento: 4,
  consumidor_final: 5,
  monotributista: 6,
};

export interface ArcaIvaItem {
  Id: ArcaIvaRateId;
  BaseImp: number; // Base imponible en pesos con 2 decimales
  Importe: number; // Importe de IVA en pesos con 2 decimales
}

export interface CreateElectronicInvoiceItem {
  product_id?: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  iva_percentage?: number; // Default 21 o 0 si emisor monotributo
}

export interface CreateElectronicInvoiceRequest {
  sale_id?: string;
  customer_id?: string;
  customer_name: string;
  document_type?: 'DNI' | 'CUIT' | 'CUIL' | 'SinIdentificar';
  document_number?: string;
  iva_condition?: 'responsable_inscripto' | 'monotributista' | 'consumidor_final' | 'sujeto_exento';
  invoice_type?: 'A' | 'B' | 'C' | 'NC_A' | 'NC_B' | 'NC_C';
  concept?: ArcaConcept;
  items: CreateElectronicInvoiceItem[];
  // Ajustes de la venta asociada. La factura debe reflejar lo efectivamente
  // cobrado, así que el descuento/recargo se reparte proporcionalmente entre
  // los ítems antes de discriminar el IVA.
  discount_cents?: number;
  surcharge_cents?: number;
}

export interface ElectronicInvoiceRecord {
  id: string;
  tenant_id: string;
  sale_id?: string;
  // Cuando el comprobante es una Nota de Crédito, apunta a la factura que acredita.
  related_invoice_id?: string;
  invoice_number: number;
  punto_venta: number;
  invoice_type: string;
  cuit_emisor: string;
  cuit_receptor?: string;
  customer_id?: string;
  customer_name: string;
  document_type: string;
  document_number?: string;
  iva_condition: string;
  total_cents: number;
  net_cents: number;
  iva_cents: number;
  iva_percentage: number;
  other_taxes_cents: number;
  cae?: string;
  cae_due_date?: string;
  afip_result?: string;
  afip_response?: Record<string, unknown>;
  // `true` cuando el comprobante se emitió en Modo Sandbox (CAE simulado, sin
  // validez fiscal). Se deriva de `afip_response.sandbox` al leer la base.
  is_sandbox?: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  created_by: string;
  created_at: string;
  updated_at: string;
  qr_url?: string;
  items?: {
    id: string;
    product_id?: string;
    description: string;
    quantity: number;
    unit_price_cents: number;
    subtotal_cents: number;
    iva_percentage: number;
    iva_cents: number;
  }[];
}
