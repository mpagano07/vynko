import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { supabaseAnon } from '@/lib/supabaseAnon';
import { PLAN_LIMITS, NEW_ACCOUNT_PLAN } from '@/lib/plans';
import { createActivityLog } from '@/lib/activity-log';
import type { AuthInfo } from '@/lib/api-auth';
import type { PlanId } from '@/lib/plans';
import {
  canAssignRole,
  canManageCollaboratorRole,
  highestRole,
  normalizeAssignableRole,
  type TenantRole,
} from '@/lib/roles';
import {
  invitationCooldownRemainingMs,
  invitationExpiresAt,
  isInvitationExpired,
  MAX_PENDING_INVITATIONS_PER_TENANT,
} from '@/lib/invitation-policy';
import { logger } from '@/lib/logger';

export type CollaboratorResult =
  | { ok: true; body: unknown; status: number }
  | { ok: false; error: string; status: number };

const ROLE_FALLBACK: TenantRole = 'member';
const NOT_A_MANAGER = 'Only owners and managers can manage collaborators';

/**
 * Cierra las sesiones de auth de una persona que se quedo sin ninguna
 * membresia activa. La funcion SQL decide: si sigue activa en otra sucursal no
 * toca nada. Es best-effort a proposito, porque la membresia ya quedo
 * actualizada y el backend igual le niega el tenant al refresh token.
 */
async function revokeSessionsIfNoActiveMembership(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('revoke_user_sessions_if_no_active_membership', {
    p_user_id: userId,
  });
  if (error) {
    logger.warn('No se pudieron revocar las sesiones del colaborador sin membresias activas', {
      error,
      userId,
    });
  }
}

/**
 * Sucursales que el usuario puede administrar. Un manager sólo manda en las
 * suyas; el owner manda en todas las que le pertenecen. Los roles se resuelven
 * por sucursal porque la misma persona puede ser owner en una y manager en otra.
 */
interface ManagedScope {
  ownerTenantIds: string[];
  managerTenantIds: string[];
  tenantIds: string[];
}

async function getManagedScope(userId: string): Promise<ManagedScope> {
  const { data } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', userId)
    .eq('status', 'active')
    .in('role', ['owner', 'manager']);

  const rows = data ?? [];
  const ownerTenantIds = rows
    .filter((row) => row.role === 'owner')
    .map((row) => row.tenant_id as string);
  const managerTenantIds = rows
    .filter((row) => row.role === 'manager')
    .map((row) => row.tenant_id as string);

  return {
    ownerTenantIds,
    managerTenantIds,
    tenantIds: [...new Set([...ownerTenantIds, ...managerTenantIds])],
  };
}

/** Rol del actor en una sucursal: owner, manager o null si no administra. */
function actorRoleInTenant(scope: ManagedScope, tenantId: string): TenantRole | null {
  if (scope.ownerTenantIds.includes(tenantId)) return 'owner';
  if (scope.managerTenantIds.includes(tenantId)) return 'manager';
  return null;
}

/**
 * Arma el mapa sucursal → rol pedido y valida que el actor pueda asignarlo.
 *
 * `memberships` (rol por sucursal) gana sobre el par histórico `role` +
 * `tenant_ids`. Todo tenant_id se filtra contra las sucursales que el actor
 * administra: uno ajeno no puede colarse por el body.
 */
function buildDesiredRoles(
  scope: ManagedScope,
  body: {
    role?: string;
    tenant_ids?: string[];
    memberships?: { tenant_id?: string; role?: string }[];
  }
): { ok: true; roleByTenant: Map<string, TenantRole> } | { ok: false; error: string; status: number } {
  const rawMemberships = Array.isArray(body.memberships) ? body.memberships : [];
  const roleByTenant = new Map<string, TenantRole>();

  if (rawMemberships.length > 0) {
    for (const item of rawMemberships) {
      const tid = typeof item?.tenant_id === 'string' ? item.tenant_id : '';
      if (!tid || !scope.tenantIds.includes(tid)) continue;
      const role = normalizeAssignableRole(item?.role);
      if (!canAssignRole(actorRoleInTenant(scope, tid), role)) {
        return {
          ok: false,
          status: 403,
          error: 'Sólo el propietario puede asignar el rol Manager',
        };
      }
      roleByTenant.set(tid, role);
    }
  } else {
    // Sin lista explícita NO se asume "todas": mandar una invitación a cada
    // sucursal por omisión era la forma más fácil de filtrar accesos sin
    // querer. Si no vino ninguna sucursal válida, el llamador recibe el 400 de
    // abajo y tiene que elegir.
    const requestedTenantIds = Array.isArray(body.tenant_ids)
      ? [...new Set(body.tenant_ids.filter((id) => scope.tenantIds.includes(id)))]
      : [];
    const role = normalizeAssignableRole(body.role);
    for (const tid of requestedTenantIds) {
      if (!canAssignRole(actorRoleInTenant(scope, tid), role)) {
        return {
          ok: false,
          status: 403,
          error: 'Sólo el propietario puede asignar el rol Manager',
        };
      }
      roleByTenant.set(tid, role);
    }
  }

  if (roleByTenant.size === 0) {
    return { ok: false, error: 'No valid tenants selected', status: 400 };
  }

  return { ok: true, roleByTenant };
}

async function enforceUserLimit(tenantId: string): Promise<string | null> {
  const { data: tenantRow } = await supabaseAdmin
    .from('tenants')
    .select('subscription_plan')
    .eq('id', tenantId)
    .single();
  const plan = (tenantRow?.subscription_plan as PlanId) || NEW_ACCOUNT_PLAN;
  const maxUsers = PLAN_LIMITS[plan]?.users ?? 1;
  if (maxUsers === Infinity) return null;
  const { count } = await supabaseAdmin
    .from('tenant_users')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'active');
  if ((count ?? 0) >= maxUsers) {
    return `Tu plan actual (${plan}) permite hasta ${maxUsers} usuario${maxUsers !== 1 ? 's' : ''}. Mejorá tu plan para agregar colaboradores.`;
  }
  return null;
}

interface CollaboratorMembership {
  id: string;
  tenant_id: string;
  tenant_name: string;
  role: string;
  status: string;
  joined_at: string | null;
}

export async function listCollaborators(auth: AuthInfo): Promise<CollaboratorResult> {
  try {
    const scope = await getManagedScope(auth.userId);
    if (scope.tenantIds.length === 0) {
      return { ok: false, error: NOT_A_MANAGER, status: 403 };
    }

    const { data: allMembers } = await supabaseAdmin
      .from('tenant_users')
      .select('id, user_id, role, status, joined_at, tenant_id')
      .in('tenant_id', scope.tenantIds);

    if (!allMembers) {
      return { ok: false, error: 'Failed to fetch members', status: 500 };
    }

    const userIds = [...new Set(allMembers.map((m) => m.user_id as string))].filter(Boolean);
    const tenantIds = [...new Set(allMembers.map((m) => m.tenant_id as string))].filter(Boolean);

    const [profilesRes, tenantsRes] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('id, email, full_name, avatar_url')
        .in('id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']),
      supabaseAdmin
        .from('tenants')
        .select('id, name')
        .in('id', tenantIds.length > 0 ? tenantIds : ['00000000-0000-0000-0000-000000000000']),
    ]);

    const profileMap = new Map((profilesRes.data || []).map((p) => [p.id, p]));
    const tenantMap = new Map((tenantsRes.data || []).map((t) => [t.id, t]));

    const userTenants: Record<string, { id: string; name: string }[]> = {};
    const userRoles: Record<string, string> = {};
    const userTus: Record<string, string[]> = {};
    const userMemberships: Record<string, CollaboratorMembership[]> = {};
    const userJoinedAt: Record<string, string | null> = {};

    for (const m of allMembers) {
      const uid = m.user_id as string;
      const tid = m.tenant_id as string;
      const tn = tenantMap.get(tid);
      const joinedAt = (m.joined_at as string | null) ?? null;
      const status = (m.status as string) || 'active';

      if (!userTenants[uid]) userTenants[uid] = [];
      if (!userTus[uid]) userTus[uid] = [];
      if (!userMemberships[uid]) userMemberships[uid] = [];

      if (tn) userTenants[uid].push({ id: tn.id, name: tn.name });
      userTus[uid].push(m.id as string);
      userMemberships[uid].push({
        id: m.id as string,
        tenant_id: tid,
        tenant_name: tn?.name || '',
        role: (m.role as string) || 'member',
        status,
        joined_at: joinedAt,
      });

      const isActiveMembership = status === 'active';
      if (isActiveMembership && joinedAt && (!userJoinedAt[uid] || joinedAt < userJoinedAt[uid]!)) {
        userJoinedAt[uid] = joinedAt;
      }

      // El rol que se muestra arriba es el más alto de todas las sucursales
      // activas. El detalle real, sucursal por sucursal, viaja en `memberships`.
      if (isActiveMembership) {
        userRoles[uid] = highestRole([userRoles[uid], m.role as string]);
      }
    }

    const collaborators = Object.entries(userTenants).map(([uid, tenants]) => {
      const p = profileMap.get(uid);
      const memberships = (userMemberships[uid] || []).sort((a, b) =>
        a.tenant_name.localeCompare(b.tenant_name)
      );
      return {
        user_id: uid,
        role: (userRoles[uid] as TenantRole | undefined) || 'member',
        active: memberships.some((m) => m.status === 'active'),
        email: p?.email || '',
        full_name: p?.full_name || '',
        avatar_url: p?.avatar_url || null,
        tenants: tenants.sort((a, b) => a.name.localeCompare(b.name)),
        tenant_users_ids: userTus[uid] || [],
        memberships,
        joined_at: userJoinedAt[uid] || null,
      };
    });

    const { data: pendingInvitations } = await supabaseAdmin
      .from('invitations')
      .select('id, email, role, created_at, expires_at, invited_by, tenant_id')
      .in('tenant_id', scope.tenantIds)
      .is('accepted_at', null)
      .order('created_at', { ascending: false });

    const now = new Date();
    let invitations = (pendingInvitations || []).map((inv) => {
      const expiresAt = (inv.expires_at as string | null) ?? null;
      return {
        id: inv.id as string,
        email: inv.email as string,
        role: (inv.role as string) || 'member',
        created_at: (inv.created_at as string | null) ?? null,
        expires_at: expiresAt,
        expired: isInvitationExpired(expiresAt, now),
        invited_by: (inv.invited_by as string | null) ?? null,
        invited_by_name: null as string | null,
        tenant_id: inv.tenant_id as string,
        tenant_name: tenantMap.get(inv.tenant_id as string)?.name || '',
      };
    });

    if (invitations.length > 0) {
      const inviterIds = [...new Set(invitations.map((i) => i.invited_by).filter(Boolean))] as string[];
      if (inviterIds.length > 0) {
        const { data: inviters } = await supabaseAdmin
          .from('profiles')
          .select('id, full_name, email')
          .in('id', inviterIds);
        const inviterMap = new Map((inviters || []).map((p) => [p.id as string, p]));
        invitations = invitations.map((inv) => {
          const inviter = inv.invited_by ? inviterMap.get(inv.invited_by) : undefined;
          return {
            ...inv,
            invited_by_name: (inviter?.full_name as string) || (inviter?.email as string) || null,
          };
        });
      }
    }

    return {
      ok: true,
      body: { collaborators, pendingInvitations: invitations },
      status: 200,
    };
  } catch (err) {
    logger.error('Error listing collaborators:', { error: err });
    return { ok: false, error: 'Internal server error', status: 500 };
  }
}

interface AddCollaboratorBody {
  email?: string;
  role?: string;
  tenant_ids?: string[];
  /**
   * Rol por sucursal. Si viene, manda sobre `role`/`tenant_ids`. Es lo que usa
   * el modal de edición para asignar, por ejemplo, Manager en una sucursal y
   * Consulta en otra.
   */
  memberships?: { tenant_id?: string; role?: string }[];
  full_name?: string;
  /** Reenvío explícito: saltea el enfriamiento entre invitaciones iguales. */
  resend?: boolean;
}

export async function addCollaborator(
  auth: AuthInfo,
  body: AddCollaboratorBody,
  origin: string
): Promise<CollaboratorResult> {
  try {
    const scope = await getManagedScope(auth.userId);
    if (scope.tenantIds.length === 0) {
      return { ok: false, error: NOT_A_MANAGER, status: 403 };
    }

    const { email, full_name } = body;

    if (!email || typeof email !== 'string') {
      return { ok: false, error: 'Email is required', status: 400 };
    }

    const desired = buildDesiredRoles(scope, body);
    if (!desired.ok) return desired;
    const { roleByTenant } = desired;

    const targetTenantIds = [...roleByTenant.keys()];
    const assignRole = highestRole([...roleByTenant.values()]);
    const assignName = typeof full_name === 'string' && full_name.trim() ? full_name.trim() : null;

    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existingProfile) {
      // `profiles` es global: esa fila pertenece a la persona, no a la empresa.
      // Saber si ya es de la casa no alcanza para poder agregarla: solo se
      // agrega directo a quien YA es miembro de alguno de los tenants que este
      // actor administra (o sea, ya consintio trabajar con el). A un desconocido
      // registrado en la plataforma hay que invitarlo y esperar que acepte.
      const { data: memberships } = await supabaseAdmin
        .from('tenant_users')
        .select('tenant_id, role')
        .eq('user_id', existingProfile.id);
      const isKnown = (memberships ?? []).some((m) =>
        scope.tenantIds.includes(m.tenant_id as string)
      );

      if (!isKnown) {
        return inviteByEmail(auth, scope, email.toLowerCase(), roleByTenant, origin, body.resend === true);
      }

      // Un manager no puede tocar a un owner ni a otro manager: sería una vía
      // para degradar a un par o ascender a un cómplice sin pasar por el owner.
      for (const requestedTenantId of targetTenantIds) {
        const actorRole = actorRoleInTenant(scope, requestedTenantId);
        const targetRole = (memberships ?? []).find(
          (m) => m.tenant_id === requestedTenantId
        )?.role as string | undefined;
        if (targetRole && !canManageCollaboratorRole(actorRole, targetRole)) {
          return {
            ok: false,
            status: 403,
            error: 'Un manager no puede modificar a un propietario ni a otro manager',
          };
        }
      }

      // `profiles` es su identidad global, asi que solo se permite cargarle un
      // nombre si no trabaja también en otra empresa fuera de este alcance.
      if (assignName) {
        const foreignMemberships = (memberships ?? []).filter(
          (m) => !scope.tenantIds.includes(m.tenant_id as string)
        );

        if (foreignMemberships.length === 0) {
          await supabaseAdmin
            .from('profiles')
            .update({ full_name: assignName })
            .eq('id', existingProfile.id);
        }
      }

      interface MembershipRow {
        id: string;
        tenant_id: string;
        role: string;
        status: string | null;
      }

      // Primero se resuelve qué sucursales hay que crear o reactivar y se
      // validan todos los límites: si una está llena, no queremos dejar altas
      // a medias en las demás.
      const rowsToCreate: string[] = [];
      const rowsToReactivate: MembershipRow[] = [];
      for (const tid of targetTenantIds) {
        const { data: existingMember } = await supabaseAdmin
          .from('tenant_users')
          .select('id, role, status')
          .eq('tenant_id', tid)
          .eq('user_id', existingProfile.id)
          .maybeSingle();

        if (!existingMember) {
          rowsToCreate.push(tid);
          continue;
        }

        const row = existingMember as MembershipRow;
        if ((row.status ?? 'active') === 'active') continue;

        if (!canManageCollaboratorRole(actorRoleInTenant(scope, tid), row.role)) {
          return {
            ok: false,
            status: 403,
            error: 'Un manager no puede reactivar a un propietario ni a otro manager',
          };
        }
        rowsToReactivate.push(row);
      }

      for (const tid of [...rowsToCreate, ...rowsToReactivate.map((r) => r.tenant_id)]) {
        const limitError = await enforceUserLimit(tid);
        if (limitError) {
          return { ok: false, error: limitError, status: 403 };
        }
      }

      for (const tid of rowsToCreate) {
        const tenantRole = roleByTenant.get(tid) ?? ROLE_FALLBACK;
        const { error: insertError } = await supabaseAdmin
          .from('tenant_users')
          .insert({ tenant_id: tid, user_id: existingProfile.id, role: tenantRole });
        if (insertError) {
          logger.error(`Error adding to tenant ${tid}:`, { error: insertError });
          continue;
        }
        await createActivityLog({
          tenantId: tid,
          userId: auth.userId,
          action: 'add_collaborator',
          entityType: 'collaborator',
          entityId: existingProfile.id,
          details: { email: email.toLowerCase(), role: tenantRole },
        });
      }

      for (const row of rowsToReactivate) {
        const tenantRole = roleByTenant.get(row.tenant_id) ?? ROLE_FALLBACK;
        const { error: updateError } = await supabaseAdmin
          .from('tenant_users')
          .update({ role: tenantRole, status: 'active', joined_at: new Date().toISOString() })
          .eq('id', row.id);
        if (updateError) {
          logger.error(`Error reactivating in tenant ${row.tenant_id}:`, { error: updateError });
          continue;
        }
        await createActivityLog({
          tenantId: row.tenant_id,
          userId: auth.userId,
          action: 'reactivate_collaborator',
          entityType: 'collaborator',
          entityId: existingProfile.id,
          details: { email: email.toLowerCase(), role: tenantRole },
        });
      }

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name, avatar_url')
        .eq('id', existingProfile.id)
        .single();

      return {
        ok: true,
        status: 201,
        body: {
          collaborator: {
            user_id: existingProfile.id,
            role: assignRole,
            active: true,
            email: profile?.email || email,
            full_name: profile?.full_name || '',
            avatar_url: profile?.avatar_url || null,
            tenants: [],
          },
        },
      };
    }

    return inviteByEmail(auth, scope, email.toLowerCase(), roleByTenant, origin, body.resend === true);
  } catch (err) {
    logger.error('Error adding collaborator:', { error: err });
    return { ok: false, error: 'Internal server error', status: 500 };
  }
}

/**
 * Crea las invitaciones pendientes (una por sucursal) y manda un solo email.
 * El invitado entra a `tenant_users` recién cuando acepta
 * (`acceptInvitationsForUser`), que es lo que convierte el alta de un
 * desconocido en algo que solo pasa con su venia.
 *
 * El nombre que cargo el actor NO se guarda: la persona lo escribe al aceptar.
 * No devuelve ningún dato del invitado: el actor solo ve que la invitación se
 * creó, nunca el nombre/avatar de la persona detrás del email.
 */
async function inviteByEmail(
  auth: AuthInfo,
  scope: ManagedScope,
  email: string,
  roleByTenant: Map<string, TenantRole>,
  origin: string,
  resend: boolean
): Promise<CollaboratorResult> {
  const tenantIds = [...roleByTenant.keys()];
  if (tenantIds.length === 0) {
    return { ok: false, error: 'No valid tenants selected', status: 400 };
  }

  // Una sola lectura de pendientes para dos reglas: tope por sucursal y
  // enfriamiento del mismo email. Se miran vencidas también para no contar
  // invitaciones que ya no pueden aceptarse.
  const { data: pendingInvitations } = await supabaseAdmin
    .from('invitations')
    .select('id, tenant_id, email, created_at, expires_at')
    .in('tenant_id', tenantIds)
    .is('accepted_at', null);

  const now = new Date();
  const livePending = (pendingInvitations ?? []).filter(
    (inv) => !isInvitationExpired(inv.expires_at as string | null, now)
  );

  for (const tid of tenantIds) {
    const pendingInTenant = livePending.filter((inv) => inv.tenant_id === tid);
    if (pendingInTenant.length >= MAX_PENDING_INVITATIONS_PER_TENANT) {
      return {
        ok: false,
        status: 403,
        error: 'Esta sucursal alcanzó el máximo de invitaciones pendientes. Revocá alguna antes de invitar a otra persona.',
      };
    }
  }

  if (!resend) {
    const sameEmail = livePending.find(
      (inv) => inv.tenant_id === tenantIds[0] && String(inv.email).toLowerCase() === email
    );
    const remaining = invitationCooldownRemainingMs(sameEmail?.created_at as string | null, now);
    if (sameEmail && remaining > 0) {
      const minutes = Math.ceil(remaining / 60000);
      return {
        ok: false,
        status: 409,
        error: `Ya hay una invitación pendiente para ese email. Podés reenviarla desde la lista en ${minutes} minuto${minutes !== 1 ? 's' : ''}.`,
      };
    }
  }

  // Se validan todas las sucursales antes de escribir: si una está llena, no
  // queremos dejar invitaciones a medias en las demás.
  for (const tid of tenantIds) {
    const limitError = await enforceUserLimit(tid);
    if (limitError) {
      return { ok: false, error: limitError, status: 403 };
    }
  }

  const expiresAt = invitationExpiresAt(now);
  const createdAt = now.toISOString();
  const { error: inviteRowError } = await supabaseAdmin.from('invitations').upsert(
    tenantIds.map((tid) => ({
      tenant_id: tid,
      email,
      role: roleByTenant.get(tid) ?? ROLE_FALLBACK,
      invited_by: auth.userId,
      // Si la fila ya existía (p. ej. una invitación vieja ya aceptada de
      // alguien que después salió del equipo), se reactiva como pendiente y
      // se le renueva el vencimiento.
      accepted_at: null,
      created_at: createdAt,
      expires_at: expiresAt,
    })),
    { onConflict: 'tenant_id,email' }
  );

  if (inviteRowError) {
    logger.error('DB error:', { error: inviteRowError });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  // Si el email no sale, la invitación pendiente no sirve para nada: se
  // revierte para que el owner pueda reintentar sin chocar con el enfriamiento
  // ni con el tope de pendientes, y para que la lista no muestre una
  // invitación que nadie recibió.
  const delivery = await deliverInvitationEmail(email, origin);
  if (!delivery.ok) {
    await discardPendingInvitations(tenantIds, email, createdAt);
    return { ok: false, status: delivery.status, error: delivery.error };
  }

  for (const tid of tenantIds) {
    await createActivityLog({
      tenantId: tid,
      userId: auth.userId,
      action: 'invite_collaborator',
      entityType: 'collaborator',
      entityId: email,
      details: { email, role: roleByTenant.get(tid) ?? ROLE_FALLBACK },
    });
  }

  return {
    ok: true,
    status: 201,
    body: {
      invited: true,
      email,
      tenant_ids: tenantIds,
      message: delivery.existingAccount
        ? 'Ese email ya tiene cuenta en Vynko. Le enviamos un link de acceso para que entre y acepte la invitación.'
        : 'Invitación enviada por email.',
    },
  };
}

type EmailDelivery =
  | { ok: true; existingAccount: boolean }
  | { ok: false; status: number; error: string };

interface AuthErrorLike {
  code?: string | null;
  message?: string | null;
  status?: number;
}

function isEmailExistsError(error: AuthErrorLike): boolean {
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return true;
  return (
    error.status === 422 &&
    /already been registered|already registered|already exists/i.test(error.message ?? '')
  );
}

function describeEmailError(error: AuthErrorLike): { status: number; error: string } {
  if (error.status === 429 || error.code === 'over_email_send_rate_limit') {
    return {
      status: 429,
      error:
        'Supabase limita el envío a 2 emails por hora con el proveedor incorporado. Configurá un SMTP propio o reintentá más tarde.',
    };
  }
  return {
    status: 502,
    error: 'No se pudo enviar el email de invitación. Revisá la configuración de correo y reintentá.',
  };
}

/**
 * Manda el email que corresponde según quién es el invitado.
 *
 * `inviteUserByEmail` sólo funciona con emails que todavía no tienen cuenta:
 * para uno ya registrado Supabase devuelve `email_exists` y no envía nada. En
 * ese caso se manda un magic link, que sirve para cualquier cuenta existente.
 */
async function deliverInvitationEmail(email: string, origin: string): Promise<EmailDelivery> {
  // Los dos caminos apuntan a `/auth/magic`: Supabase entrega la sesión en el
  // fragmento (`#access_token=...`), que el servidor no puede leer, así que el
  // canje tiene que ocurrir en el navegador. Desde ahí se sigue a
  // `/accept-invite`, que acepta la invitación y pide nombre/contraseña.
  const redirectTo = `${origin}/auth/magic?next=${encodeURIComponent('/accept-invite')}`;

  const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  });

  if (!inviteError) return { ok: true, existingAccount: false };

  const error = inviteError as AuthErrorLike;

  if (!isEmailExistsError(error)) {
    logger.error('No se pudo enviar la invitación por email:', {
      code: error.code,
      status: error.status,
      message: error.message,
    });
    return { ok: false, ...describeEmailError(error) };
  }

  const { error: otpError } = await supabaseAnon.auth.signInWithOtp({
    email,
    options: {
      // El usuario ya existe: nada de crear cuentas desde acá.
      shouldCreateUser: false,
      emailRedirectTo: redirectTo,
    },
  });

  if (otpError) {
    logger.error('No se pudo enviar el magic link de invitación:', {
      code: (otpError as AuthErrorLike).code,
      status: (otpError as AuthErrorLike).status,
      message: otpError.message,
    });
    return { ok: false, ...describeEmailError(otpError as AuthErrorLike) };
  }

  return { ok: true, existingAccount: true };
}

/** Borra únicamente las filas que acaba de escribir este intento. */
async function discardPendingInvitations(
  tenantIds: string[],
  email: string,
  createdAt: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('invitations')
    .delete()
    .in('tenant_id', tenantIds)
    .eq('email', email)
    .is('accepted_at', null)
    .eq('created_at', createdAt);

  if (error) {
    logger.error('No se pudieron limpiar las invitaciones sin email:', { error: error.message });
  }
}

export async function updateCollaborator(
  auth: AuthInfo,
  targetUserId: string,
  body: {
    role?: string;
    tenant_ids?: string[];
    memberships?: { tenant_id?: string; role?: string }[];
    /** Nombre visible de la persona. Se ignora si viene vacío. */
    full_name?: string | null;
  }
): Promise<CollaboratorResult> {
  try {
    const scope = await getManagedScope(auth.userId);
    if (scope.tenantIds.length === 0) {
      return { ok: false, error: 'Only owners and managers can edit collaborators', status: 403 };
    }

    if (targetUserId === auth.userId) {
      return { ok: false, error: 'No podés editar tu propio rol', status: 400 };
    }

    const desired = buildDesiredRoles(scope, body);
    if (!desired.ok) return desired;
    const { roleByTenant: desiredRoleByTenant } = desired;

    const targetTenantIds = [...desiredRoleByTenant.keys()];

    const { data: existingRows } = await supabaseAdmin
      .from('tenant_users')
      .select('id, tenant_id, role, status')
      .eq('user_id', targetUserId)
      .in('tenant_id', scope.tenantIds);

    if (!existingRows || existingRows.length === 0) {
      return { ok: false, error: 'Collaborator not found in your tenants', status: 404 };
    }

    if (existingRows.some((r) => r.role === 'owner')) {
      return { ok: false, error: 'No podés modificar al propietario', status: 400 };
    }

    // El manager sólo puede tocar miembros operativos de sus sucursales.
    for (const row of existingRows) {
      const actorRole = actorRoleInTenant(scope, row.tenant_id as string);
      if (!canManageCollaboratorRole(actorRole, row.role as string)) {
        return {
          ok: false,
          status: 403,
          error: 'Un manager no puede modificar a un propietario ni a otro manager',
        };
      }
    }

    // El nombre vive en `profiles`, que es identidad global: se valida acá y se
    // escribe recién al final, cuando las membresías ya se aplicaron bien.
    let nameChange: { nextName: string; previousName: string | null } | null = null;
    if (typeof body.full_name === 'string' && body.full_name.trim()) {
      const nextName = body.full_name.trim();
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name')
        .eq('id', targetUserId)
        .maybeSingle();

      if (!profile) {
        return { ok: false, error: 'Collaborator not found', status: 404 };
      }

      const previousName = (profile.full_name as string | null) ?? null;
      if (nextName !== previousName) {
        const { data: allMemberships } = await supabaseAdmin
          .from('tenant_users')
          .select('tenant_id')
          .eq('user_id', targetUserId);

        // Igual que al agregar: el perfil es compartido entre empresas, así que
        // sólo se puede renombrar a quien no trabaja también fuera de este
        // alcance. Si no, cada empresa podría pisarle el nombre a la persona.
        const worksElsewhere = (allMemberships ?? []).some(
          (membership) => !scope.tenantIds.includes(membership.tenant_id as string)
        );
        if (worksElsewhere) {
          return {
            ok: false,
            status: 403,
            error:
              'Ese colaborador también trabaja en otra empresa. El nombre lo administra esa persona desde su perfil.',
          };
        }

        nameChange = { nextName, previousName };
      }
    }

    const currentTenantIds = existingRows.map((r) => r.tenant_id as string);
    const rowByTenant = new Map(existingRows.map((r) => [r.tenant_id as string, r]));
    const toRemoveTenantIds = currentTenantIds.filter((id) => !desiredRoleByTenant.has(id));
    const toAddTenantIds = targetTenantIds.filter((id) => !currentTenantIds.includes(id));
    const toUpdateTenantIds = targetTenantIds.filter(
      (id) =>
        currentTenantIds.includes(id) &&
        (rowByTenant.get(id)?.role !== desiredRoleByTenant.get(id) ||
          rowByTenant.get(id)?.status === 'inactive')
    );

    for (const tid of toAddTenantIds) {
      const { data: tenantRow } = await supabaseAdmin
        .from('tenants')
        .select('subscription_plan')
        .eq('id', tid)
        .single();
      const plan = (tenantRow?.subscription_plan as PlanId) || NEW_ACCOUNT_PLAN;
      const maxUsers = PLAN_LIMITS[plan]?.users ?? 1;
      if (maxUsers !== Infinity) {
        const { count } = await supabaseAdmin
          .from('tenant_users')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tid)
          .eq('status', 'active');
        if ((count ?? 0) >= maxUsers) {
          return {
            ok: false,
            error: `La sucursal supera el límite de usuarios de tu plan (${plan}). Mejorá tu plan para asignarla.`,
            status: 403,
          };
        }
      }
    }

    if (toRemoveTenantIds.length > 0) {
      const { error } = await supabaseAdmin
        .from('tenant_users')
        .delete()
        .eq('user_id', targetUserId)
        .in('tenant_id', toRemoveTenantIds)
        .neq('role', 'owner');
      if (error) {
        logger.error('DB error:', { error });
        return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
      }
    }

    if (toAddTenantIds.length > 0) {
      const { error } = await supabaseAdmin
        .from('tenant_users')
        .insert(toAddTenantIds.map((tid) => ({
          tenant_id: tid,
          user_id: targetUserId,
          role: desiredRoleByTenant.get(tid) ?? ROLE_FALLBACK,
        })));
      if (error) {
        logger.error('DB error:', { error });
        return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
      }
    }

    // Un update por cada rol distinto: las sucursales que comparten rol se
    // actualizan juntas y las que no cambian no se tocan. Si la fila estaba
    // inactiva, esta operación también la reactiva.
    const updateByRole = new Map<TenantRole, string[]>();
    for (const tid of toUpdateTenantIds) {
      const desiredRole = desiredRoleByTenant.get(tid)!;
      const ids = updateByRole.get(desiredRole) ?? [];
      ids.push(tid);
      updateByRole.set(desiredRole, ids);
    }

    for (const [desiredRole, tenantIds] of updateByRole) {
      const { error: updateError } = await supabaseAdmin
        .from('tenant_users')
        .update({ role: desiredRole, status: 'active' })
        .eq('user_id', targetUserId)
        .in('tenant_id', tenantIds)
        .neq('role', 'owner');

      if (updateError) {
        logger.error('DB error:', { error: updateError });
        return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
      }
    }

    if (toRemoveTenantIds.length > 0) {
      await revokeSessionsIfNoActiveMembership(targetUserId);
    }

    for (const tid of toUpdateTenantIds) {
      await createActivityLog({
        tenantId: tid,
        userId: auth.userId,
        action: 'update_collaborator',
        entityType: 'collaborator',
        entityId: targetUserId,
        details: {
          previous_role: rowByTenant.get(tid)?.role || null,
          new_role: desiredRoleByTenant.get(tid) ?? ROLE_FALLBACK,
        },
      });
    }
    for (const tid of toRemoveTenantIds) {
      await createActivityLog({
        tenantId: tid,
        userId: auth.userId,
        action: 'remove_from_branch',
        entityType: 'collaborator',
        entityId: targetUserId,
        details: { branch_role: rowByTenant.get(tid)?.role || null },
      });
    }
    for (const tid of toAddTenantIds) {
      await createActivityLog({
        tenantId: tid,
        userId: auth.userId,
        action: 'add_to_branch',
        entityType: 'collaborator',
        entityId: targetUserId,
        details: { role: desiredRoleByTenant.get(tid) ?? ROLE_FALLBACK },
      });
    }

    if (nameChange) {
      const { error: nameError } = await supabaseAdmin
        .from('profiles')
        .update({ full_name: nameChange.nextName })
        .eq('id', targetUserId);

      if (nameError) {
        logger.error('DB error:', { error: nameError });
        return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
      }

      for (const tid of targetTenantIds) {
        await createActivityLog({
          tenantId: tid,
          userId: auth.userId,
          action: 'update_collaborator_name',
          entityType: 'collaborator',
          entityId: targetUserId,
          details: { previous_name: nameChange.previousName, new_name: nameChange.nextName },
        });
      }
    }

    return { ok: true, body: { success: true }, status: 200 };
  } catch (err) {
    logger.error('Error editing collaborator:', { error: err });
    return { ok: false, error: 'Internal server error', status: 500 };
  }
}

export async function deleteCollaborator(
  auth: AuthInfo,
  targetUserId: string,
  tenantId?: string
): Promise<CollaboratorResult> {
  try {
    const scope = await getManagedScope(auth.userId);
    if (scope.tenantIds.length === 0) {
      return { ok: false, error: 'Only owners and managers can remove collaborators', status: 403 };
    }

    if (targetUserId === auth.userId) {
      return { ok: false, error: 'No podés quitarte a vos mismo del equipo', status: 400 };
    }

    if (tenantId && !scope.tenantIds.includes(tenantId)) {
      return { ok: false, error: 'Collaborator not found', status: 404 };
    }

    const scopedTenantIds = tenantId ? [tenantId] : scope.tenantIds;

    const { data: rows } = await supabaseAdmin
      .from('tenant_users')
      .select('id, tenant_id, role, status, user_id')
      .eq('user_id', targetUserId)
      .in('tenant_id', scopedTenantIds);

    if (!rows || rows.length === 0) {
      return { ok: false, error: 'Collaborator not found', status: 404 };
    }

    if (rows.some((r) => r.role === 'owner')) {
      return { ok: false, error: 'Cannot remove the owner', status: 400 };
    }

    for (const row of rows) {
      const actorRole = actorRoleInTenant(scope, row.tenant_id as string);
      if (!canManageCollaboratorRole(actorRole, row.role as string)) {
        return {
          ok: false,
          status: 403,
          error: 'Un manager no puede quitar a un propietario ni a otro manager',
        };
      }
    }

    const { error } = await supabaseAdmin
      .from('tenant_users')
      .delete()
      .eq('user_id', targetUserId)
      .in('tenant_id', scopedTenantIds)
      .neq('role', 'owner');

    if (error) {
      logger.error('DB error:', { error });
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }

    await revokeSessionsIfNoActiveMembership(targetUserId);

    // Se audita solo donde la persona era miembro de verdad: `scopedTenantIds`
    // puede incluir sucursales del actor en las que nunca estuvo.
    for (const row of rows) {
      await createActivityLog({
        tenantId: row.tenant_id as string,
        userId: auth.userId,
        action: tenantId ? 'remove_from_branch' : 'remove_collaborator',
        entityType: 'collaborator',
        entityId: targetUserId,
        details: { branch_only: Boolean(tenantId), previous_role: row.role },
      });
    }

    return { ok: true, body: { success: true }, status: 200 };
  } catch (err) {
    logger.error('Error removing collaborator:', { error: err });
    return { ok: false, error: 'Internal server error', status: 500 };
  }
}

/**
 * Desactiva o reactiva una membresía sin borrarla. Desactivar es lo que
 * corresponde cuando alguien deja el equipo temporalmente: conserva el
 * historial, la persona deja de resolver tenant en `getAuth`/sesión y puede
 * volver con el mismo rol.
 *
 * El borrado definitivo sigue existiendo (`deleteCollaborator`) y es el único
 * que quita la fila.
 */
export async function setCollaboratorActive(
  auth: AuthInfo,
  targetUserId: string,
  active: boolean,
  tenantId?: string
): Promise<CollaboratorResult> {
  try {
    const scope = await getManagedScope(auth.userId);
    if (scope.tenantIds.length === 0) {
      return { ok: false, error: NOT_A_MANAGER, status: 403 };
    }

    if (targetUserId === auth.userId) {
      return { ok: false, error: 'No podés cambiar tu propio estado', status: 400 };
    }

    if (tenantId && !scope.tenantIds.includes(tenantId)) {
      return { ok: false, error: 'Collaborator not found', status: 404 };
    }

    const scopedTenantIds = tenantId ? [tenantId] : scope.tenantIds;

    const { data: rows } = await supabaseAdmin
      .from('tenant_users')
      .select('id, tenant_id, role')
      .eq('user_id', targetUserId)
      .in('tenant_id', scopedTenantIds);

    if (!rows || rows.length === 0) {
      return { ok: false, error: 'Collaborator not found', status: 404 };
    }

    for (const row of rows) {
      if (row.role === 'owner') {
        return { ok: false, error: 'No podés desactivar al propietario', status: 400 };
      }
      if (!canManageCollaboratorRole(actorRoleInTenant(scope, row.tenant_id as string), row.role as string)) {
        return {
          ok: false,
          status: 403,
          error: 'Un manager no puede cambiar el estado de otro manager',
        };
      }
    }

    const { error } = await supabaseAdmin
      .from('tenant_users')
      .update({ status: active ? 'active' : 'inactive' })
      .eq('user_id', targetUserId)
      .in('tenant_id', scopedTenantIds)
      .neq('role', 'owner');

    if (error) {
      logger.error('DB error:', { error });
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }

    if (!active) {
      await revokeSessionsIfNoActiveMembership(targetUserId);
    }

    for (const row of rows) {
      await createActivityLog({
        tenantId: row.tenant_id as string,
        userId: auth.userId,
        action: active ? 'reactivate_collaborator' : 'deactivate_collaborator',
        entityType: 'collaborator',
        entityId: targetUserId,
        details: { branch_only: Boolean(tenantId), role: row.role },
      });
    }

    return { ok: true, body: { success: true, active }, status: 200 };
  } catch (err) {
    logger.error('Error changing collaborator status:', { error: err });
    return { ok: false, error: 'Internal server error', status: 500 };
  }
}

/**
 * Transfiere la propiedad de una sucursal. La transferencia real la hace la
 * función SQL `transfer_tenant_ownership` (migración 066): promueve primero al
 * nuevo owner y recién después degrada al anterior, para que el trigger del
 * último owner nunca vea una empresa sin propietario.
 */
export async function transferOwnership(
  auth: AuthInfo,
  tenantId: string | null | undefined,
  newOwnerUserId: string | null | undefined
): Promise<CollaboratorResult> {
  try {
    if (!tenantId || typeof tenantId !== 'string') {
      return { ok: false, error: 'tenant_id is required', status: 400 };
    }
    if (!newOwnerUserId || typeof newOwnerUserId !== 'string') {
      return { ok: false, error: 'new_owner_user_id is required', status: 400 };
    }
    if (newOwnerUserId === auth.userId) {
      return { ok: false, error: 'Ya sos el propietario de esa sucursal', status: 400 };
    }

    const { data: actorRow } = await supabaseAdmin
      .from('tenant_users')
      .select('role, status')
      .eq('tenant_id', tenantId)
      .eq('user_id', auth.userId)
      .maybeSingle();

    if (!actorRow || actorRow.role !== 'owner' || actorRow.status !== 'active') {
      return { ok: false, error: 'Sólo el propietario puede transferir la empresa', status: 403 };
    }

    const { data: targetRow } = await supabaseAdmin
      .from('tenant_users')
      .select('role, status')
      .eq('tenant_id', tenantId)
      .eq('user_id', newOwnerUserId)
      .maybeSingle();

    if (!targetRow) {
      return { ok: false, error: 'El colaborador no pertenece a esa sucursal', status: 404 };
    }
    if (targetRow.status !== 'active') {
      return { ok: false, error: 'No podés transferir la propiedad a un colaborador inactivo', status: 400 };
    }
    if (targetRow.role === 'owner') {
      return { ok: false, error: 'Ese colaborador ya es propietario', status: 400 };
    }

    const { error } = await supabaseAdmin.rpc('transfer_tenant_ownership', {
      p_tenant_id: tenantId,
      p_new_owner: newOwnerUserId,
      p_actor: auth.userId,
    });

    if (error) {
      const message = String(error.message ?? '');
      if (message.includes('last_owner_protected')) {
        return { ok: false, error: 'La empresa no puede quedar sin propietario', status: 400 };
      }
      if (message.includes('transfer_target_inactive')) {
        return { ok: false, error: 'No podés transferir la propiedad a un colaborador inactivo', status: 400 };
      }
      if (message.includes('transfer_target_not_member')) {
        return { ok: false, error: 'El colaborador no pertenece a esa sucursal', status: 404 };
      }
      if (message.includes('transfer_not_owner')) {
        return { ok: false, error: 'Sólo el propietario puede transferir la empresa', status: 403 };
      }
      if (message.includes('transfer_target_already_owner')) {
        return { ok: false, error: 'Ese colaborador ya es propietario', status: 400 };
      }
      if (message.includes('transfer_same_user')) {
        return { ok: false, error: 'Ya sos el propietario de esa sucursal', status: 400 };
      }
      logger.error('DB error:', { error });
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }

    await createActivityLog({
      tenantId,
      userId: auth.userId,
      action: 'transfer_ownership',
      entityType: 'collaborator',
      entityId: newOwnerUserId,
      details: { previous_owner: auth.userId, new_owner: newOwnerUserId },
    });

    return { ok: true, body: { success: true }, status: 200 };
  } catch (err) {
    logger.error('Error transferring ownership:', { error: err });
    return { ok: false, error: 'Internal server error', status: 500 };
  }
}

export async function revokeInvitation(
  auth: AuthInfo,
  invitationId: string
): Promise<CollaboratorResult> {
  try {
    const scope = await getManagedScope(auth.userId);
    if (scope.tenantIds.length === 0) {
      return { ok: false, error: 'Only owners and managers can manage invitations', status: 403 };
    }

    const { data: invitation } = await supabaseAdmin
      .from('invitations')
      .select('id, tenant_id, email, role')
      .eq('id', invitationId)
      .in('tenant_id', scope.tenantIds)
      .maybeSingle();

    if (!invitation) {
      return { ok: false, error: 'Invitation not found', status: 404 };
    }

    const { error } = await supabaseAdmin
      .from('invitations')
      .delete()
      .eq('id', invitationId)
      .in('tenant_id', scope.tenantIds);

    if (error) {
      logger.error('DB error:', { error });
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }

    await createActivityLog({
      tenantId: invitation.tenant_id as string,
      userId: auth.userId,
      action: 'revoke_invitation',
      entityType: 'collaborator',
      entityId: invitation.email as string,
      details: { email: invitation.email, role: invitation.role },
    });

    return { ok: true, body: { success: true }, status: 200 };
  } catch (err) {
    logger.error('Error revoking invitation:', { error: err });
    return { ok: false, error: 'Internal server error', status: 500 };
  }
}
