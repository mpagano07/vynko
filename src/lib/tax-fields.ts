export const IVA_CONDITIONS = [
  'responsable_inscripto',
  'monotributista',
  'consumidor_final',
  'sujeto_exento',
  'responsable_no_inscripto',
] as const;

export type IvaCondition = (typeof IVA_CONDITIONS)[number];

export const IVA_CONDITION_LABELS: Record<IvaCondition, string> = {
  responsable_inscripto: 'Responsable Inscripto',
  monotributista: 'Monotributista',
  consumidor_final: 'Consumidor Final',
  sujeto_exento: 'Sujeto Exento',
  responsable_no_inscripto: 'Responsable No Inscripto',
};

export const PARTY_DOCUMENT_TYPES = ['DNI', 'CUIL', 'CUIT', 'Pasaporte', 'CE'] as const;

export type PartyDocumentType = (typeof PARTY_DOCUMENT_TYPES)[number];

export const PARTY_DOCUMENT_TYPE_LABELS: Record<PartyDocumentType, string> = {
  DNI: 'DNI',
  CUIL: 'CUIL',
  CUIT: 'CUIT',
  Pasaporte: 'Pasaporte',
  CE: 'Cédula de Identidad',
};

export interface PartyTaxFields {
  cuit?: string | null;
  iva_condition?: string | null;
  document_type?: string | null;
  document_number?: string | null;
}

export function onlyDigits(value?: string | null): string {
  return (value || '').replace(/\D/g, '');
}

function isDigitsOnly(value: string): boolean {
  return /^[\d\s.-]+$/.test(value);
}

export function formatCuit(value?: string | null): string {
  const raw = (value || '').trim();
  const digits = onlyDigits(raw);
  if (digits.length !== 11) return raw;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

/**
 * Formatea un CUIT mientras se escribe: sólo números y guiones en las
 * posiciones que corresponde (`20-12345678-9`).
 */
export function formatCuitInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  const head = `${digits.slice(0, 2)}-${digits.slice(2, 10)}`;
  return digits.length > 10 ? `${head}-${digits.slice(10)}` : head;
}

/**
 * Normaliza lo que se tipea en el campo "número de documento" según el tipo
 * elegido: CUIT con guiones, DNI/CUIL sólo números, Pasaporte/CE alfanuméricos.
 */
export function formatDocumentNumberInput(value: string, documentType?: string | null): string {
  const type = (documentType || 'DNI').trim();

  if (type === 'Pasaporte' || type === 'CE') {
    return value.replace(/[^A-Za-z0-9]/g, '').slice(0, 15);
  }
  if (type === 'CUIT') return formatCuitInput(value);

  const maxLength = type === 'CUIL' ? 11 : 8;
  return value.replace(/\D/g, '').slice(0, maxLength);
}

/**
 * Normaliza los datos fiscales antes de guardarlos: CUIT y números de
 * documento quedan sin separadores (`.`, `-`, espacios), el resto va recortado.
 */
export function normalizePartyTaxFields(input: PartyTaxFields): PartyTaxFields {
  const documentType = (input.document_type || '').trim() || null;
  const documentNumber = (input.document_number || '').trim() || null;
  const needsDigits = !documentType || documentType === 'DNI' || documentType === 'CUIL' || documentType === 'CUIT';

  return {
    cuit: (input.cuit || '').trim() ? onlyDigits(input.cuit) : null,
    iva_condition: (input.iva_condition || '').trim() || null,
    document_type: documentType,
    document_number: documentNumber
      ? needsDigits
        ? onlyDigits(documentNumber)
        : documentNumber
      : null,
  };
}

export const PARTY_TAX_FIELD_KEYS = ['cuit', 'iva_condition', 'document_type', 'document_number'] as const;

/**
 * Normaliza sólo los campos fiscales presentes en `body` (típico de un PATCH):
 * los que no vienen no se tocan para no pisar datos ya guardados.
 */
export function normalizeProvidedTaxFields(body: Record<string, unknown>): PartyTaxFields {
  const input: Record<string, unknown> = {};
  for (const key of PARTY_TAX_FIELD_KEYS) {
    if (body[key] !== undefined) input[key] = body[key];
  }

  const normalized = normalizePartyTaxFields(input as PartyTaxFields);
  const out: Record<string, unknown> = {};
  for (const key of PARTY_TAX_FIELD_KEYS) {
    if (body[key] !== undefined) out[key] = normalized[key];
  }
  return out as PartyTaxFields;
}

/**
 * Valida los datos fiscales mínimos de un tercero (cliente o proveedor) para
 * poder facturarle. Devuelve el mensaje de error o `null` si todo está bien.
 *
 * `requireCuit` se usa para clientes: son a quienes les emitimos el
 * comprobante, y un Responsable Inscripto sin CUIT no puede recibir una
 * Factura A.
 */
export function validatePartyTaxFields(
  input: PartyTaxFields,
  opts?: { requireCuit?: boolean }
): string | null {
  const cuit = (input.cuit || '').trim();
  const ivaCondition = (input.iva_condition || '').trim();
  const documentType = (input.document_type || '').trim();
  const documentNumber = (input.document_number || '').trim();

  if (ivaCondition && !IVA_CONDITIONS.includes(ivaCondition as IvaCondition)) {
    return 'La condición frente al IVA no es válida';
  }

  if (documentType && !PARTY_DOCUMENT_TYPES.includes(documentType as PartyDocumentType)) {
    return 'El tipo de documento no es válido';
  }

  if (cuit) {
    if (!isDigitsOnly(cuit)) return 'El CUIT sólo puede contener números';
    if (onlyDigits(cuit).length !== 11) return 'El CUIT debe tener 11 dígitos';
  }

  if (documentNumber) {
    const effectiveType = (documentType || 'DNI') as PartyDocumentType;

    if (effectiveType === 'Pasaporte' || effectiveType === 'CE') {
      if (documentNumber.length < 4) return `El ${effectiveType} debe tener al menos 4 caracteres`;
    } else {
      if (!isDigitsOnly(documentNumber)) return `El ${effectiveType} sólo puede contener números`;
      const digits = onlyDigits(documentNumber);
      if (effectiveType === 'DNI') {
        if (digits.length < 7 || digits.length > 8) return 'El DNI debe tener 7 u 8 dígitos';
      } else if (digits.length !== 11) {
        return `El ${effectiveType} debe tener 11 dígitos`;
      }
    }
  }

  if (opts?.requireCuit && ivaCondition === 'responsable_inscripto') {
    const hasCuit = Boolean(onlyDigits(cuit).length === 11) || (documentType === 'CUIT' && onlyDigits(documentNumber).length === 11);
    if (!hasCuit) return 'Los Responsables Inscriptos necesitan un CUIT para facturar';
  }

  return null;
}
