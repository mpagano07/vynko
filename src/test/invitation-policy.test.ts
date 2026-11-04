import { describe, expect, it } from 'vitest';
import {
  INVITATION_RESEND_COOLDOWN_MINUTES,
  INVITATION_TTL_DAYS,
  MAX_PENDING_INVITATIONS_PER_TENANT,
  invitationCooldownRemainingMs,
  invitationExpiresAt,
  isInvitationExpired,
} from '@/lib/invitation-policy';

describe('política de invitaciones', () => {
  it('vence a los siete días de creada', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    expect(INVITATION_TTL_DAYS).toBe(7);
    expect(invitationExpiresAt(from)).toBe('2026-01-08T00:00:00.000Z');
  });

  it('una invitación sin `expires_at` no se considera vencida', () => {
    // Filas creadas antes de la migración 066 no tienen la columna todavía.
    expect(isInvitationExpired(null)).toBe(false);
    expect(isInvitationExpired(undefined)).toBe(false);
  });

  it('detecta el vencimiento por fecha', () => {
    const now = new Date('2026-01-08T00:00:00.000Z');
    expect(isInvitationExpired('2026-01-07T23:59:59.000Z', now)).toBe(true);
    expect(isInvitationExpired('2026-01-08T00:00:00.000Z', now)).toBe(true);
    expect(isInvitationExpired('2026-01-08T00:00:01.000Z', now)).toBe(false);
  });

  it('un vencimiento inválido no bloquea la aceptación', () => {
    expect(isInvitationExpired('no-es-una-fecha')).toBe(false);
  });

  it('bloquea el reenvío durante diez minutos', () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    expect(INVITATION_RESEND_COOLDOWN_MINUTES).toBe(10);
    expect(invitationCooldownRemainingMs('2026-01-01T11:55:00.000Z', now)).toBe(5 * 60 * 1000);
    expect(invitationCooldownRemainingMs('2026-01-01T12:00:00.000Z', now)).toBe(10 * 60 * 1000);
    expect(invitationCooldownRemainingMs('2026-01-01T11:49:00.000Z', now)).toBe(0);
    expect(invitationCooldownRemainingMs(null, now)).toBe(0);
    expect(invitationCooldownRemainingMs('no-es-una-fecha', now)).toBe(0);
  });

  it('limita las pendientes por sucursal', () => {
    expect(MAX_PENDING_INVITATIONS_PER_TENANT).toBe(50);
  });
});
