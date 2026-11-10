/**
 * Pedazos compartidos del import de terceros (clientes y proveedores).
 *
 * El import de productos armó su propia maquinaria dentro de product-service
 * porque resuelve categorías, stock y catálogo global. Los terceros no tienen
 * nada de eso: la diferencia entre importar clientes y proveedores es la tabla
 * destino y el gate de permisos, así que la normalización de filas y las guardas
 * comunes viven acá y cada servicio completa el write.
 */

import type { AuthInfo } from '@/lib/api-auth';
import { rateLimit } from '@/lib/rate-limit';
import { matchIvaCondition, matchPartyDocumentType } from '@/lib/tax-fields';
import { MAX_IMPORT_ROWS } from '@/lib/excel-import-parse';

export type PartyImportKind = 'customers' | 'suppliers';

export type PartyImportRowResult = {
  row: number;
  status: 'created' | 'updated' | 'skipped';
  name?: string;
  error?: string;
};

export type PartyImportSummary = {
  created: number;
  updated: number;
  skipped: number;
  total: number;
};

export interface PartyImportProgress {
  processed: number;
  total: number;
  created: number;
  updated: number;
  skipped: number;
}

export type PartyImportProgressCallback = (progress: PartyImportProgress) => void;

export type PartyImportGuardFailure = {
  ok: false;
  error: string;
  status: 400 | 403 | 413 | 429 | 500;
};

export type PreparedPartyImport =
  | PartyImportGuardFailure
  | {
      ok: true;
      total: number;
      execute: (
        onProgress?: PartyImportProgressCallback
      ) => Promise<{ results: PartyImportRowResult[]; summary: PartyImportSummary }>;
    };

/**
 * Fila ya normalizada y lista para escribir. `null` significa "la celda venía
 * vacía" (no informar: en un update se conserva lo que ya tiene el tercero);
 * `undefined` en las condiciones fiscales es lo mismo pero permite distinguir
 * "no vino la columna" de "vino vacía" a la hora de armar el update.
 */
export type PartyImportCandidate = {
  index: number;
  rowNumber: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  contactName: string | null;
  cuit: string | null;
  ivaCondition?: string;
  documentType?: string;
  documentNumber: string | null;
};

/** Celda a string trimado. Vacía → null (no informado). */
export function cellString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}

/**
 * Plega el nombre de un tercero para el matcheo del import: minúsculas, sin
 * acentos y con espacios colapsados (mismo criterio que usan los labels de
 * planilla en tax-fields). Así un "Perez" del archivo encuentra al "Pérez"
 * que ya existe en vez de duplicarlo.
 */
export function partyNameKey(name: unknown): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Normaliza una fila del archivo. Todo lo que no depende de la base se valida
 * acá (misma fase que el import de productos): nombre presente y labels de
 * IVA/documento reconocibles. Lo que sí depende (el merge con el existente y su
 * validación fiscal) queda para el momento del write de cada servicio.
 *
 * `contactName` sólo lo usa el import de proveedores; en clientes la columna
 * se ignora igual que en el alta manual.
 */
export function buildPartyCandidate(
  row: Record<string, unknown>,
  index: number
): { ok: true; candidate: PartyImportCandidate } | { ok: false; error: string } {
  const name = cellString(row.name);
  if (!name) return { ok: false, error: 'Nombre requerido' };

  const ivaProvided = cellString(row.iva_condition);
  let ivaCondition: string | undefined;
  if (ivaProvided !== null) {
    const matched = matchIvaCondition(ivaProvided);
    if (!matched) return { ok: false, error: 'La condición frente al IVA no es válida' };
    ivaCondition = matched;
  }

  const docTypeProvided = cellString(row.document_type);
  let documentType: string | undefined;
  if (docTypeProvided !== null) {
    const matched = matchPartyDocumentType(docTypeProvided);
    if (!matched) return { ok: false, error: 'El tipo de documento no es válido' };
    documentType = matched;
  }

  return {
    ok: true,
    candidate: {
      index,
      rowNumber: index + 1,
      name,
      email: cellString(row.email),
      phone: cellString(row.phone),
      address: cellString(row.address),
      notes: cellString(row.notes),
      contactName: cellString(row.contact_name),
      cuit: cellString(row.cuit),
      ivaCondition,
      documentType,
      documentNumber: cellString(row.document_number),
    },
  };
}

/**
 * Guardas de entrada del import de terceros: cuerpo válido y tope de filas.
 * Idénticas a las de productos pero con su propio mensaje. Devuelve las filas
 * ya acotadas para que el servicio no vuelva a validar el array.
 */
export function partyImportBodyGuard(
  rows: Record<string, unknown>[] | undefined
): { ok: true; rows: Record<string, unknown>[] } | PartyImportGuardFailure {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: 'No rows provided', status: 400 };
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `La importación acepta hasta ${MAX_IMPORT_ROWS} filas por vez (enviaste ${rows.length}).`,
      status: 413,
    };
  }
  return { ok: true, rows };
}

/**
 * Rate limits del import de terceros. Los mismos números que el de productos
 * (30/hora por tenant, 10/hora por usuario) pero con claves propias para que
 * un import de clientes no le quite la cuota del catálogo a un import de
 * productos que corre en paralelo.
 */
export async function partyImportRateLimits(
  auth: AuthInfo,
  kind: PartyImportKind
): Promise<PartyImportGuardFailure | null> {
  const tenantLimit = await rateLimit(`import:${kind}:tenant:${auth.tenantId}`, 30, 60 * 60 * 1000);
  if (!tenantLimit.ok) {
    return { ok: false, error: 'Límite de importaciones alcanzado. Probá de nuevo más tarde.', status: 429 };
  }
  const userLimit = await rateLimit(`import:${kind}:user:${auth.userId}`, 10, 60 * 60 * 1000);
  if (!userLimit.ok) {
    return { ok: false, error: 'Límite de importaciones alcanzado. Probá de nuevo más tarde.', status: 429 };
  }
  return null;
}
