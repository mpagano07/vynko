export const INVITATION_TTL_DAYS = 7;
/** Tope de invitaciones pendientes por sucursal: frena el spam de emails. */
export const MAX_PENDING_INVITATIONS_PER_TENANT = 50;
/** Ventana en la que repetir una invitación no vuelve a mandar email. */
export const INVITATION_RESEND_COOLDOWN_MINUTES = 10;

/** Vencimiento por defecto de una invitación nueva. */
export function invitationExpiresAt(from: Date = new Date()): string {
  return new Date(from.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * ¿La invitación está vencida?
 *
 * `null`/`undefined` se trata como "sin vencimiento" para no invalidar filas
 * creadas antes de la migración 066. La migración las rellena, pero un entorno
 * sin aplicar todavía no debería romper la aceptación.
 */
export function isInvitationExpired(
  expiresAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!expiresAt) return false;
  const time = new Date(expiresAt).getTime();
  return Number.isFinite(time) && time <= now.getTime();
}

/** Minutos que faltan para poder reenviar una invitación sin `resend`. */
export function invitationCooldownRemainingMs(
  createdAt: string | null | undefined,
  now: Date = new Date()
): number {
  if (!createdAt) return 0;
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 0;
  const readyAt = created + INVITATION_RESEND_COOLDOWN_MINUTES * 60 * 1000;
  return Math.max(0, readyAt - now.getTime());
}
