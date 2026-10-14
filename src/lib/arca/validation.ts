// Límite (en pesos) desde el cual ARCA exige identificar al consumidor final
// (RG 5700/2025). Por debajo, el comprobante puede ir "sin identificar".
export const CONSUMIDOR_FINAL_IDENTIFICACION_MIN = 10_000_000;

export interface FacturaReceptorForm {
  invoice_type: string;
  customer_name: string;
  document_type: string;
  document_number: string;
  iva_condition: string;
}

/**
 * Valida los datos mínimos obligatorios del receptor antes de emitir una
 * factura. Devuelve el mensaje de error o `null` si está todo completo.
 *
 * Reglas (ARCA / WSFEv1):
 * - El número de documento debe corresponder al tipo elegido (CUIT/CUIL 11
 *   dígitos; DNI 7 u 8).
 * - Factura A: el receptor debe ser Responsable Inscripto y estar identificado
 *   con CUIT (ARCA valida además que el CUIT esté activo en el padrón).
 * - Factura B: no corresponde a un receptor Responsable Inscripto (va Factura A).
 * - Factura C: si el receptor no es consumidor final, hay que identificarlo con CUIT.
 * - Consumidor final por importes altos: exige DNI/CUIT.
 */
export function validateFacturaReceptor(
  form: FacturaReceptorForm,
  totalPesos: number
): string | null {
  const docType = form.document_type;
  const docNumber = form.document_number.replace(/\D/g, '');
  const cond = form.iva_condition;
  const type = form.invoice_type;

  if (!form.customer_name.trim()) {
    return 'Ingresá el nombre o razón social del cliente';
  }

  if (docType === 'CUIT' || docType === 'CUIL') {
    if (!docNumber) return `Ingresá el ${docType} del cliente`;
    if (docNumber.length !== 11) return `El ${docType} debe tener 11 dígitos`;
  } else if (docType === 'DNI') {
    if (!docNumber) return 'Ingresá el DNI del cliente';
    if (docNumber.length < 7 || docNumber.length > 8) return 'El DNI debe tener 7 u 8 dígitos';
  }

  if (type === 'A') {
    if (cond !== 'responsable_inscripto') {
      return 'Para Factura A el receptor debe ser Responsable Inscripto en el IVA';
    }
    if (docType !== 'CUIT') return 'Factura A exige el CUIT del receptor';
  }

  if (type === 'B' && cond === 'responsable_inscripto') {
    return 'A un Responsable Inscripto le corresponde Factura A, no Factura B';
  }

  if (type === 'C' && cond !== 'consumidor_final' && docType !== 'CUIT') {
    return 'Identificá al cliente con CUIT para emitir este comprobante';
  }

  if (docType === 'SinIdentificar' && totalPesos >= CONSUMIDOR_FINAL_IDENTIFICACION_MIN) {
    return 'Para importes desde $10.000.000 tenés que identificar al cliente con DNI o CUIT';
  }

  return null;
}
