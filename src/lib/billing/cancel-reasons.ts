/**
 * Motivos de baja de suscripción.
 *
 * La lista es cerrada y vive acá (no en el componente) porque la usan los tres
 * lados del flujo: el modal para renderizar las opciones, la ruta para validar
 * el body y el servicio para guardarlo. Si se agrega un motivo, alcanza con
 * tocar este archivo; no hay ningún CHECK en la base que migrar.
 *
 * Nunca se guarda texto libre: evita PII y mantiene los motivos agregables.
 */
export const CANCEL_REASON_IDS = ['price', 'learning', 'low_sales', 'closed', 'other'] as const;

export type CancelReasonId = (typeof CANCEL_REASON_IDS)[number];

export const CANCEL_REASONS: ReadonlyArray<{ id: CancelReasonId; label: string }> = [
  { id: 'price', label: 'Me resulta caro' },
  { id: 'learning', label: 'No terminé de entender cómo usarlo' },
  { id: 'low_sales', label: 'No estoy teniendo ventas' },
  { id: 'closed', label: 'Cerré el negocio' },
  { id: 'other', label: 'Otro motivo' },
];
