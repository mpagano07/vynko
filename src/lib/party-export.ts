/**
 * Generación de planillas de exportación de terceros (clientes y proveedores).
 *
 * Es el equivalente de `excel-export.ts` para /customers y /providers: misma
 * mecánica client-side (SheetJS + descarga desde el navegador), sin variantes
 * de plataforma porque no hay terceros que esperen un formato propio — sólo
 * XLS y CSV.
 *
 * El contrato de ida y vuelta es el mismo que el de productos: los encabezados
 * de acá son alias que reconoce `parsePartyWorkbookFile`, así que un archivo
 * exportado vuelve a entrar por el import sin tocar nada. Los valores de IVA y
 * tipo de documento se escriben con su label legible ("Responsable Inscripto",
 * "Pasaporte") porque el import también sabe re-interpretarlos.
 */

import {
  IVA_CONDITION_LABELS,
  PARTY_DOCUMENT_TYPE_LABELS,
  formatCuit,
  type IvaCondition,
  type PartyDocumentType,
} from '@/lib/tax-fields';
import { downloadBlob, sheetToBlob, type ExportFormat } from '@/lib/excel-export';

export type PartyExportKind = 'customers' | 'suppliers';

/**
 * Estructura mínima que necesitan las filas. `Supplier` de
 * `lib/types/supplier` y el `Customer` de la página cumplen solos.
 */
export type PartyExportRecord = {
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  cuit?: string | null;
  iva_condition?: string | null;
  document_type?: string | null;
  document_number?: string | null;
};

const PARTY_LABELS: Record<PartyExportKind, { plural: string; sheetName: string; fileBase: string }> = {
  customers: { plural: 'clientes', sheetName: 'Clientes', fileBase: 'clientes' },
  suppliers: { plural: 'proveedores', sheetName: 'Proveedores', fileBase: 'proveedores' },
};

function ivaLabel(value?: string | null): string {
  if (!value) return '';
  return IVA_CONDITION_LABELS[value as IvaCondition] ?? value;
}

function documentTypeLabel(value?: string | null): string {
  if (!value) return '';
  return PARTY_DOCUMENT_TYPE_LABELS[value as PartyDocumentType] ?? value;
}

/**
 * Filas de la planilla por tipo de tercero. Clientes y proveedores comparten
 * columna fiscal y de contacto; la diferencia es que el contacto y las notas
 * sólo existen para proveedores, así que en clientes no se exportan (el alta
 * manual de clientes tampoco los pide).
 */
export function buildPartyExportRows(parties: PartyExportRecord[], kind: PartyExportKind): Record<string, unknown>[] {
  if (kind === 'customers') {
    return parties.map((party) => ({
      'Nombre': party.name,
      'CUIT': formatCuit(party.cuit),
      'Condición IVA': ivaLabel(party.iva_condition),
      'Tipo de documento': documentTypeLabel(party.document_type),
      'Número de documento': party.document_number || '',
      'Email': party.email || '',
      'Teléfono': party.phone || '',
      'Dirección': party.address || '',
    }));
  }

  return parties.map((party) => ({
    'Nombre': party.name,
    'Contacto': party.contact_name || '',
    'CUIT': formatCuit(party.cuit),
    'Condición IVA': ivaLabel(party.iva_condition),
    'Tipo de documento': documentTypeLabel(party.document_type),
    'Número de documento': party.document_number || '',
    'Email': party.email || '',
    'Teléfono': party.phone || '',
    'Dirección': party.address || '',
    'Notas': party.notes || '',
  }));
}

/** Nombre del archivo: `clientes_2026-11-10.xls`, igual criterio que productos. */
export function partyExportFileName(kind: PartyExportKind, format: ExportFormat, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return `${PARTY_LABELS[kind].fileBase}_${day}.${format}`;
}

/** Genera el Blob sin descargarlo (lo usa el modal de export para mostrar el conteo). */
export async function generatePartyExportBlob(options: {
  parties: PartyExportRecord[];
  kind: PartyExportKind;
  format: ExportFormat;
  now?: Date;
}): Promise<{ blob: Blob; fileName: string }> {
  const { parties, kind, format, now = new Date() } = options;
  const rows = buildPartyExportRows(parties, kind);
  const blob = await sheetToBlob(rows, PARTY_LABELS[kind].sheetName, format);
  return { blob, fileName: partyExportFileName(kind, format, now) };
}

/** Genera y descarga la planilla. */
export async function exportPartiesFile(options: {
  parties: PartyExportRecord[];
  kind: PartyExportKind;
  format: ExportFormat;
  now?: Date;
}): Promise<void> {
  const { blob, fileName } = await generatePartyExportBlob(options);
  downloadBlob(blob, fileName);
}
