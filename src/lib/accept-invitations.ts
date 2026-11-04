import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { PLAN_LIMITS, NEW_ACCOUNT_PLAN } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';
import { isInvitationExpired } from '@/lib/invitation-policy';
import { normalizeAssignableRole } from '@/lib/roles';
import { logger } from '@/lib/logger';

interface UserLike {
  id: string;
  email?: string | null;
}

export async function acceptInvitationsForUser(user: UserLike) {
  let accepted = 0;
  if (!user.email) return { accepted };

  const { data: invitations } = await supabaseAdmin
    .from('invitations')
    .select('id, tenant_id, role, expires_at')
    .eq('email', user.email.toLowerCase())
    .is('accepted_at', null);

  if (!invitations || invitations.length === 0) {
    return { accepted };
  }

  const now = new Date();

  for (const inv of invitations) {
    // Una invitación vencida se ignora: no se marca como aceptada para que el
    // owner la vea como vencida y pueda reenviarla. Antes un email viejo servía
    // para entrar años después.
    if (isInvitationExpired(inv.expires_at as string | null, now)) {
      logger.info('Invitación vencida ignorada', {
        invitationId: inv.id,
        tenantId: inv.tenant_id,
      });
      continue;
    }

    const { data: existingMember } = await supabaseAdmin
      .from('tenant_users')
      .select('id, role, status')
      .eq('tenant_id', inv.tenant_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingMember) {
      // La persona ya es miembro de esa sucursal. Se marca la invitación como
      // aceptada sin tocar su rol: un `upsert` con `role: inv.role` podía
      // degradar a un owner o pisar un ascenso hecho después de invitar.
      //
      // Si su membresía estaba inactiva, aceptar la invitación la reactiva con
      // el rol invitado. Nunca se toca a un owner: reactivarlo o degradarlo
      // desde una invitación sería una vía de escalada.
      if (existingMember.status !== 'active' && existingMember.role !== 'owner') {
        const { error: reactivateError } = await supabaseAdmin
          .from('tenant_users')
          .update({
            role: normalizeAssignableRole(inv.role),
            status: 'active',
            joined_at: now.toISOString(),
          })
          .eq('id', existingMember.id);
        if (reactivateError) continue;
      }

      await supabaseAdmin
        .from('invitations')
        .update({ accepted_at: now.toISOString() })
        .eq('id', inv.id);
      accepted++;
      continue;
    }

    const { data: tenantRow } = await supabaseAdmin
      .from('tenants')
      .select('subscription_plan')
      .eq('id', inv.tenant_id)
      .single();
    const plan = (tenantRow?.subscription_plan as PlanId) || NEW_ACCOUNT_PLAN;
    const maxUsers = PLAN_LIMITS[plan]?.users ?? 1;
    if (maxUsers !== Infinity) {
      const { count } = await supabaseAdmin
        .from('tenant_users')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', inv.tenant_id)
        .eq('status', 'active');
      if ((count ?? 0) >= maxUsers) {
        await supabaseAdmin
          .from('invitations')
          .update({ accepted_at: now.toISOString() })
          .eq('id', inv.id);
        continue;
      }
    }

    // `profiles.tenant_id` es legado (desde la migración 034 el aislamiento se
    // ancla en `tenant_users`) y el trigger lo vuelve inmutable para el
    // cliente. Sólo se completa cuando el perfil todavía no tiene ninguna
    // empresa: alguien que ya es owner de la suya no debe terminar apuntando a
    // la empresa que lo invitó como cajero.
    const { data: existingProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      logger.error('acceptInvitationsForUser: no se pudo leer el perfil:', {
        error: profileError.message,
      });
      continue;
    }

    const profileRow: { id: string; email: string; tenant_id?: string } = {
      id: user.id,
      email: user.email,
    };
    if (!existingProfile?.tenant_id) profileRow.tenant_id = inv.tenant_id;

    const { error: upsertError } = await supabaseAdmin
      .from('profiles')
      .upsert(profileRow, { onConflict: 'id' });
    if (upsertError) continue;

    // `insert` en vez de `upsert`: si dos aceptaciones concurrentes chocan,
    // la segunda falla por UNIQUE y no reescribe el rol que la primera ya
    // asentó. El rol de una invitación vieja con `owner` cae a `member`.
    const { error: tuError } = await supabaseAdmin.from('tenant_users').insert({
      tenant_id: inv.tenant_id,
      user_id: user.id,
      role: normalizeAssignableRole(inv.role),
    });
    if (tuError) continue;

    await supabaseAdmin
      .from('invitations')
      .update({ accepted_at: now.toISOString() })
      .eq('id', inv.id);

    accepted++;
  }

  return { accepted };
}

export async function getUserTenantIds(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', userId)
    .eq('status', 'active');
  return (data ?? []).map((m) => m.tenant_id);
}

/**
 * Que tan nueva es la cuenta a partir de sus invitaciones.
 *
 * `onlyInvitationTenants` es lo que permite que `POST /api/auth/invitation-password`
 * exista sin abrir una puerta a la toma de cuentas.
 *
 * El endpoint tiene que poder fijar una contrasena sin conocer la anterior
 * (un invitado recien llegado no tiene ninguna), asi que su prueba de identidad
 * es la invitacion. Pero "tiene una invitacion" alcanza como prueba solo si el
 * usuario no es nadie conocido: con una sesion robada de una cuenta que ya
 * existe, un atacante podria fijar una contrasena nueva y quedarse con la
 * cuenta de forma permanente, esquivando justamente el control que
 * `POST /api/auth/password` si exige (la contrasena actual).
 *
 * La distincion se hace con las membresias. El resto de la app solo crea
 * invitaciones para emails sin perfil (ver `addCollaborator`): a un usuario que
 * ya esta en la empresa lo agrega directo a `tenant_users`, sin fila de
 * invitacion. Entonces:
 *
 *  - Cuenta nueva: sus membresias son exactamente los tenants de sus
 *    invitaciones. Pasa.
 *  - Cliente ya establecido, con otras empresas ademas: alguna membresia no
 *    viene de una invitacion. No pasa, y tiene que usar el cambio de contrasena
 *    con la actual.
 *
 * Importante: el chequeo se hace DESPUES de que `/api/invitations/accept` ya
 * corrio (la pagina de aceptacion lo dispara al montar), asi que el invitado
 * recien llegado ya aparece como miembro. Por eso la comparacion es "las
 * membresias estan contenidas en las invitaciones" y no al reves.
 */
export type InvitationAccountScope = {
  /** Hay al menos una invitacion para este email. */
  hasInvitation: boolean;
  /** Tenants de todas las invitaciones del email, aceptadas o no. */
  invitedTenantIds: string[];
  /** El usuario es miembro de algún tenant que no viene de una invitacion. */
  hasForeignMembership: boolean;
};

export async function getInvitationAccountScope(
  userId: string,
  email: string
): Promise<InvitationAccountScope> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return { hasInvitation: false, invitedTenantIds: [], hasForeignMembership: false };
  }

  // Sin filtro `accepted_at`: la invitacion que acaba de aceptarse sigue siendo
  // la que prueba que esta cuenta nacio de ahi.
  const { data: invitations, error } = await supabaseAdmin
    .from('invitations')
    .select('tenant_id')
    .eq('email', normalized);

  if (error) {
    // Ante una duda no se concede el permiso: es el caso que habilita el
    // endpoint, asi que un error de base tiene que frenar.
    logger.error('getInvitationAccountScope: no se pudieron leer las invitaciones:', { error: error.message });
    return { hasInvitation: false, invitedTenantIds: [], hasForeignMembership: true };
  }

  const invitedTenantIds = [...new Set((invitations ?? []).map((i) => i.tenant_id))];

  const { data: memberships, error: memberError } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', userId);

  if (memberError) {
    logger.error('getInvitationAccountScope: no se pudieron leer las membresias:', { error: memberError.message });
    return { hasInvitation: false, invitedTenantIds: [], hasForeignMembership: true };
  }

  const invited = new Set(invitedTenantIds);
  const hasForeignMembership = (memberships ?? []).some((m) => !invited.has(m.tenant_id));

  return {
    hasInvitation: invitedTenantIds.length > 0,
    invitedTenantIds,
    hasForeignMembership,
  };
}
