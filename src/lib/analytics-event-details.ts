/**
 * Formatea el metadata de un evento para la columna "Detalles" del panel.
 *
 * El metadata guarda lo que el evento necesita para ser util (el total de una
 * venta, el plan de la empresa) mezclado con lo que solo sirve para depurar
 * (los ids, de donde salio la fila). Volcarlo con JSON.stringify en la tabla
 * obligaba a leer `{"from":"tenants.created_at","plan":"business",
 * "backfilled":true}` para responder "¿que plan tiene?", asi que aca se
 * traducen las claves conocidas y se descartan las tecnicas.
 *
 * Si aparece una clave nueva desconocida, se muestra en vez de perderla: un
 * dato que no se conoce no se descarta en silencio.
 */
import { formatARS } from '@/lib/utils/currency';

export interface EventDetail {
  // Opcional a proposito: en app_return la columna de evento ya dice "Volvió",
  // y repetirlo como etiqueta queda como "Volvió: primera visita registrada".
  label?: string;
  value: string;
}

export interface FormattedEventDetails {
  details: EventDetail[];
  /** El evento fue reconstruido por el backfill, no registrado en vivo. */
  reconstructed: boolean;
  /** La fecha del evento fue corregida a mano por el backfill. */
  clamped: boolean;
}

// Claves que son de depuracion: identificadores, procedencia interna. No
// aportan nada a la persona que mira el panel.
const TECH_KEYS = new Set([
  'productId',
  'saleId',
  'documentId',
  'sessionId',
  'purchaseOrderId',
  'entityId',
  'preapproval_id',
  'source',
  'from',
  'note',
  'originalCreatedAt',
  'previousVisitAt',
  'approximate',
  'backfilled',
  'clamped',
  'via',
]);

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  business: 'Business',
  pro: 'Pro',
  unknown: 'Desconocido',
};

// Claves que el formateo de arriba ya traduce. Evitan que caigan en el
// volcado de "clave desconocida" y aparezcan dos veces.
const HANDLED_KEYS = new Set([
  'created',
  'updated',
  'skipped',
  'total',
  'plan',
  'totalCents',
  'initialFundCents',
  'hoursSinceLast',
  'itemCount',
  'documentType',
  'name',
  'sku',
  'partial',
]);

function formatPlan(plan: unknown): string | null {
  if (typeof plan !== 'string' || !plan) return null;
  return PLAN_LABELS[plan] ?? plan;
}

function formatCents(cents: unknown): string | null {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return null;
  return formatARS(cents / 100);
}

function formatCount(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value === 1 ? '1' : String(value);
}

export function formatEventDetails(
  metadata: Record<string, unknown> | null | undefined
): FormattedEventDetails {
  if (!metadata || typeof metadata !== 'object') {
    return { details: [], reconstructed: false, clamped: false };
  }

  const details: EventDetail[] = [];
  const reconstructed = metadata.backfilled === true;
  const clamped = metadata.clamped === true;

  const push = (label: string, value: string | null) => {
    if (value !== null && value !== '') details.push({ label, value });
  };

  // Importacion de Excel: viene con los cuatro contadores juntos. Tiene mas
  // sentido leer "12 creados, 3 actualizados" que cuatro chips sueltos.
  const importCreated = metadata.created;
  const importUpdated = metadata.updated;
  const importSkipped = metadata.skipped;
  const importTotal = metadata.total;
  if (typeof importTotal === 'number') {
    const parts = [
      `${formatCount(importCreated) ?? 0} creados`,
      `${formatCount(importUpdated) ?? 0} actualizados`,
    ];
    if (typeof importSkipped === 'number' && importSkipped > 0) {
      parts.push(`${importSkipped} omitidos`);
    }
    parts.push(`de ${importTotal}`);
    details.push({ label: 'Importación', value: parts.join(' · ') });
  }

  push('Plan', formatPlan(metadata.plan));
  push('Total', formatCents(metadata.totalCents));
  push('Fondo inicial', formatCents(metadata.initialFundCents));

  // app_return: null significa que no habia una visita anterior, o sea que
  // esta fila es la linea base de esa persona, no una vuelta.
  if ('hoursSinceLast' in metadata) {
    const hours = metadata.hoursSinceLast;
    if (hours === null || hours === undefined) {
      details.push({ value: 'primera visita registrada' });
    } else if (typeof hours === 'number' && Number.isFinite(hours)) {
      details.push({ value: hours >= 48 ? `tras ${Math.round(hours / 24)} días` : `tras ${Math.round(hours)} h` });
    }
  }

  if (typeof metadata.itemCount === 'number' && Number.isFinite(metadata.itemCount)) {
    push('Ítems', metadata.itemCount === 1 ? '1 artículo' : `${metadata.itemCount} artículos`);
  }

  if (typeof metadata.documentType === 'string' && metadata.documentType) {
    push('Tipo', metadata.documentType);
  }

  if (typeof metadata.name === 'string' && metadata.name) {
    const sku = typeof metadata.sku === 'string' && metadata.sku ? ` · ${metadata.sku}` : '';
    push('Producto', `${metadata.name}${sku}`);
  }

  if (typeof metadata.partial === 'boolean') {
    push('Recepción', metadata.partial ? 'parcial' : 'completa');
  }

  // Cualquier clave que no se sepa formatear se muestra cruda, para que un
  // evento nuevo no aparezca sin informacion.
  for (const [key, value] of Object.entries(metadata)) {
    if (HANDLED_KEYS.has(key) || TECH_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') continue;
    details.push({ label: key, value: String(value) });
  }

  return { details, reconstructed, clamped };
}
