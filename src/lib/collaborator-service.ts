import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { PLAN_LIMITS, NEW_ACCOUNT_PLAN } from '@/lib/plans';
import { createActivityLog } from '@/lib/activity-log';
import type { AuthInfo } from '@/lib/api-auth';
import type { PlanId } from '@/lib/plans';
import { ASSIGNABLE_ROLES, highestRole, isTenantRole, type TenantRole } from '@/lib/roles';
import { logger } from '@/lib/logger';

export type CollaboratorResult =
  | { ok: true; body: unknown; status: number }
  | { ok: false; error: string; status: number };

const ROLE_FALLBACK: TenantRole = 'member';

/**
 * Normaliza un rol que llega del body. Solo se aceptan roles asignables: el
 * `owner` no se transfiere desde Colaboradores y un valor desconocido cae a
 * `member` (comportamiento histórico) en vez de fallar en el CHECK de la base.
 */
function normalizeAssignableRole(role: string | null | undefined): TenantRole {
  return isTenantRole(role) && ASSIGNABLE_ROLES.includes(role) ? role : ROLE_FALLBACK;
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
    .eq('tenant_id', tenantId);
  if ((count ?? 0) >= maxUsers) {
    return `Tu plan actual (${plan}) permite hasta ${maxUsers} usuario${maxUsers !== 1 ? 's' : ''}. Mejorá tu plan para agregar colaboradores.`;
  }
  return null;
}

async function getOwnerTenantIds(userId: string): Promise<string[] | null> {
  const { data: ownerTus } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', userId)
    .eq('role', 'owner');
  const ids = (ownerTus || []).map((t) => t.tenant_id as string);
  return ids.length > 0 ? ids : null;
}

interface CollaboratorMembership {
  id: string;
  tenant_id: string;
  tenant_name: string;
  role: string;
  joined_at: string | null;
}

export async function listCollaborators(auth: AuthInfo): Promise<CollaboratorResult> {
  try {
    const ownerTenantIds = await getOwnerTenantIds(auth.userId);
    if (!ownerTenantIds) {
      return { ok: false, error: 'Only owners can manage collaborators', status: 403 };
    }

    const { data: allMembers } = await supabaseAdmin
      .from('tenant_users')
      .select('id, user_id, role, joined_at, tenant_id')
      .in('tenant_id', ownerTenantIds);

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
        joined_at: joinedAt,
      });

      if (joinedAt && (!userJoinedAt[uid] || joinedAt < userJoinedAt[uid]!)) {
        userJoinedAt[uid] = joinedAt;
      }

      // El rol que se muestra arriba es el más alto de todas las sucursales.
      // El detalle real, sucursal por sucursal, viaja en `memberships`.
      userRoles[uid] = highestRole([userRoles[uid], m.role as string]);
    }

    const collaborators = Object.entries(userTenants).map(([uid, tenants]) => {
      const p = profileMap.get(uid);
      return {
        user_id: uid,
        role: userRoles[uid] || 'member',
        email: p?.email || '',
        full_name: p?.full_name || '',
        avatar_url: p?.avatar_url || null,
        tenants: tenants.sort((a, b) => a.name.localeCompare(b.name)),
        tenant_users_ids: userTus[uid] || [],
        memberships: (userMemberships[uid] || []).sort((a, b) =>
          a.tenant_name.localeCompare(b.tenant_name)
        ),
        joined_at: userJoinedAt[uid] || null,
      };
    });

    const { data: pendingInvitations } = await supabaseAdmin
      .from('invitations')
      .select('id, email, role, created_at, invited_by, tenant_id')
      .in('tenant_id', ownerTenantIds)
      .is('accepted_at', null)
      .order('created_at', { ascending: false });

    let invitations = (pendingInvitations || []).map((inv) => ({
      id: inv.id as string,
      email: inv.email as string,
      role: (inv.role as string) || 'member',
      created_at: (inv.created_at as string | null) ?? null,
      invited_by: (inv.invited_by as string | null) ?? null,
      invited_by_name: null as string | null,
      tenant_id: inv.tenant_id as string,
      tenant_name: tenantMap.get(inv.tenant_id as string)?.name || '',
    }));

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
}

export async function addCollaborator(
  auth: AuthInfo,
  body: AddCollaboratorBody,
  origin: string
): Promise<CollaboratorResult> {
  try {
    const ownerTenantIds = await getOwnerTenantIds(auth.userId);
    if (!ownerTenantIds) {
      return { ok: false, error: 'Only owners can manage collaborators', status: 403 };
    }

    const { email, role, tenant_ids, memberships, full_name } = body;

    if (!email || typeof email !== 'string') {
      return { ok: false, error: 'Email is required', status: 400 };
    }

    // `memberships` (rol por sucursal) gana sobre el par `role` + `tenant_ids`
    // histórico. Siempre se filtra contra las sucursales que este owner
    // administra: un tenant_id ajeno no puede colarse por el body.
    const rawMemberships = Array.isArray(memberships) ? memberships : [];
    const roleByTenant = new Map<string, TenantRole>();
    if (rawMemberships.length > 0) {
      for (const item of rawMemberships) {
        const tid = typeof item?.tenant_id === 'string' ? item.tenant_id : '';
        if (!tid || !ownerTenantIds.includes(tid)) continue;
        roleByTenant.set(tid, normalizeAssignableRole(item?.role));
      }
    } else {
      const requestedTenantIds = Array.isArray(tenant_ids)
        ? tenant_ids.filter((id: string) => ownerTenantIds.includes(id))
        : ownerTenantIds;
      const assignRole = normalizeAssignableRole(role);
      for (const tid of requestedTenantIds) roleByTenant.set(tid, assignRole);
    }

    const targetTenantIds = [...roleByTenant.keys()];

    if (targetTenantIds.length === 0) {
      return { ok: false, error: 'No valid tenants selected', status: 400 };
    }

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
      // agrega directo a quien YA es miembro de alguno de los tenants de este
      // owner (o sea, ya consintio trabajar con el). A un desconocido registrado
      // en la plataforma hay que invitarlo y esperar que acepte, igual que a uno
      // sin cuenta: agregarlo por la fuerza metia su identidad y su acceso en
      // manos de un tercero sin que lo haya pedido.
      const { data: memberships } = await supabaseAdmin
        .from('tenant_users')
        .select('tenant_id')
        .eq('user_id', existingProfile.id);
      const isKnown = (memberships ?? []).some((m) =>
        ownerTenantIds.includes(m.tenant_id as string)
      );

      if (!isKnown) {
        // No se devuelve ningun dato de la persona (ni nombre ni avatar): seria
        // un oraculo de existencia y una fuga de PII para cualquiera que pruebe
        // emails. La invitacion se resuelve por el email, del lado del invitado.
        return inviteByEmail(auth, email.toLowerCase(), roleByTenant, origin);
      }

      // Es alguien de la casa: `profiles` es su identidad global, asi que solo
      // se permite cargarle un nombre si no trabaja tambien en otra empresa.
      if (assignName) {
        const foreignMemberships = (memberships ?? []).filter(
          (m) => !ownerTenantIds.includes(m.tenant_id as string)
        );

        // Si la persona solo trabaja en otra empresa, su nombre no se toca.
        if (foreignMemberships.length === 0) {
          await supabaseAdmin
            .from('profiles')
            .update({ full_name: assignName })
            .eq('id', existingProfile.id);
        }
      }

      // Primero se resuelve a qué sucursales hay que agregarla y se validan
      // todos los límites: si una está llena, no queremos dejar altas a medias
      // en las demás.
      const tenantsToJoin: string[] = [];
      for (const tid of targetTenantIds) {
        const { data: existingMember } = await supabaseAdmin
          .from('tenant_users')
          .select('id')
          .eq('tenant_id', tid)
          .eq('user_id', existingProfile.id)
          .maybeSingle();

        if (!existingMember) tenantsToJoin.push(tid);
      }

      for (const tid of tenantsToJoin) {
        const limitError = await enforceUserLimit(tid);
        if (limitError) {
          return { ok: false, error: limitError, status: 403 };
        }
      }

      for (const tid of tenantsToJoin) {
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
            email: profile?.email || email,
            full_name: profile?.full_name || '',
            avatar_url: profile?.avatar_url || null,
            tenants: [],
          },
        },
      };
    }

    return inviteByEmail(auth, email.toLowerCase(), roleByTenant, origin);
  } catch (err) {
    logger.error('Error adding collaborator:', { error: err });
    return { ok: false, error: 'Internal server error', status: 500 };
  }
}

/**
 * Crea las invitaciones pendientes (una por sucursal) y manda un solo email.
 * El invitado entra a `tenant_users` recien cuando acepta
 * (`acceptInvitationsForUser`), que es lo que convierte el alta de un
 * desconocido en algo que solo pasa con su venia.
 *
 * El nombre que cargo el owner NO se guarda: la persona lo escribe al aceptar
 * (la pagina de aceptacion lo pide). Cargarle identidad a un desconocido por el
 * email es justamente lo que este camino evita.
 *
 * No devuelve ningun dato del invitado: el owner solo ve que la invitacion se
 * creo, nunca el nombre/avatar de la persona detras del email.
 */
async function inviteByEmail(
  auth: AuthInfo,
  email: string,
  roleByTenant: Map<string, TenantRole>,
  origin: string
): Promise<CollaboratorResult> {
  const tenantIds = [...roleByTenant.keys()];
  if (tenantIds.length === 0) {
    return { ok: false, error: 'No valid tenants selected', status: 400 };
  }

  // Se validan todas las sucursales antes de escribir: si una está llena, no
  // queremos dejar invitaciones a medias en las demás.
  for (const tid of tenantIds) {
    const limitError = await enforceUserLimit(tid);
    if (limitError) {
      return { ok: false, error: limitError, status: 403 };
    }
  }

  const { error: inviteError } = await supabaseAdmin.from('invitations').upsert(
    tenantIds.map((tid) => ({
      tenant_id: tid,
      email,
      role: roleByTenant.get(tid) ?? ROLE_FALLBACK,
      invited_by: auth.userId,
      // Si la fila ya existía (p. ej. una invitación vieja ya aceptada de
      // alguien que después salió del equipo), se reactiva como pendiente.
      accepted_at: null,
      created_at: new Date().toISOString(),
    })),
    { onConflict: 'tenant_id,email' }
  );

  if (inviteError) {
    logger.error('DB error:', { error: inviteError });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/accept-invite`,
  });

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
      message: 'Invitación enviada por email.',
    },
  };
}

export async function updateCollaborator(
  auth: AuthInfo,
  targetUserId: string,
  body: {
    role?: string;
    tenant_ids?: string[];
    memberships?: { tenant_id?: string; role?: string }[];
  }
): Promise<CollaboratorResult> {
  try {
    const ownerTenantIds = await getOwnerTenantIds(auth.userId);
    if (!ownerTenantIds) {
      return { ok: false, error: 'Only owners can edit collaborators', status: 403 };
    }

    if (targetUserId === auth.userId) {
      return { ok: false, error: 'No podés editar tu propio rol', status: 400 };
    }

    const { role, tenant_ids, memberships } = body;

    // Igual que en el alta: `memberships` (rol por sucursal) manda sobre el
    // par histórico `role` + `tenant_ids`. Todo tenant_id se filtra contra las
    // sucursales que este owner administra.
    const rawMemberships = Array.isArray(memberships) ? memberships : [];
    const desiredRoleByTenant = new Map<string, TenantRole>();
    if (rawMemberships.length > 0) {
      for (const item of rawMemberships) {
        const tid = typeof item?.tenant_id === 'string' ? item.tenant_id : '';
        if (!tid || !ownerTenantIds.includes(tid)) continue;
        desiredRoleByTenant.set(tid, normalizeAssignableRole(item?.role));
      }
    } else {
      const requestedTenantIds: string[] = Array.isArray(tenant_ids)
        ? [...new Set(tenant_ids.filter((id: string) => ownerTenantIds.includes(id)))]
        : ownerTenantIds;
      const newRole = normalizeAssignableRole(role);
      for (const tid of requestedTenantIds) desiredRoleByTenant.set(tid, newRole);
    }

    if (desiredRoleByTenant.size === 0) {
      return { ok: false, error: 'No valid tenants selected', status: 400 };
    }

    const targetTenantIds = [...desiredRoleByTenant.keys()];

    const { data: existingRows } = await supabaseAdmin
      .from('tenant_users')
      .select('id, tenant_id, role')
      .eq('user_id', targetUserId)
      .in('tenant_id', ownerTenantIds);

    if (!existingRows || existingRows.length === 0) {
      return { ok: false, error: 'Collaborator not found in your tenants', status: 404 };
    }

    if (existingRows.some((r) => r.role === 'owner')) {
      return { ok: false, error: 'No podés modificar al propietario', status: 400 };
    }

    const currentTenantIds = existingRows.map((r) => r.tenant_id as string);
    const roleByTenant = new Map(existingRows.map((r) => [r.tenant_id as string, r.role as string]));
    const toRemoveTenantIds = currentTenantIds.filter((id) => !desiredRoleByTenant.has(id));
    const toAddTenantIds = targetTenantIds.filter((id) => !currentTenantIds.includes(id));
    const toUpdateTenantIds = targetTenantIds.filter(
      (id) =>
        currentTenantIds.includes(id) && roleByTenant.get(id) !== desiredRoleByTenant.get(id)
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
          .eq('tenant_id', tid);
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
    // actualizan juntas y las que no cambian no se tocan.
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
        .update({ role: desiredRole })
        .eq('user_id', targetUserId)
        .in('tenant_id', tenantIds)
        .neq('role', 'owner');

      if (updateError) {
        logger.error('DB error:', { error: updateError });
        return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
      }
    }

    for (const tid of toUpdateTenantIds) {
      await createActivityLog({
        tenantId: tid,
        userId: auth.userId,
        action: 'update_collaborator',
        entityType: 'collaborator',
        entityId: targetUserId,
        details: {
          previous_role: roleByTenant.get(tid) || null,
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
        details: { branch_role: roleByTenant.get(tid) || null },
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
    const ownerTenantIds = await getOwnerTenantIds(auth.userId);
    if (!ownerTenantIds) {
      return { ok: false, error: 'Only owners can remove collaborators', status: 403 };
    }

    if (targetUserId === auth.userId) {
      return { ok: false, error: 'No podés quitarte a vos mismo del equipo', status: 400 };
    }

    if (tenantId && !ownerTenantIds.includes(tenantId)) {
      return { ok: false, error: 'Collaborator not found', status: 404 };
    }

    const scopedTenantIds = tenantId ? [tenantId] : ownerTenantIds;

    const { data: rows } = await supabaseAdmin
      .from('tenant_users')
      .select('id, tenant_id, role, user_id')
      .eq('user_id', targetUserId)
      .in('tenant_id', scopedTenantIds);

    if (!rows || rows.length === 0) {
      return { ok: false, error: 'Collaborator not found', status: 404 };
    }

    if (rows.some((r) => r.role === 'owner')) {
      return { ok: false, error: 'Cannot remove the owner', status: 400 };
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

    // Se audita solo donde la persona era miembro de verdad: `scopedTenantIds`
    // puede incluir sucursales del owner en las que nunca estuvo.
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

export async function revokeInvitation(
  auth: AuthInfo,
  invitationId: string
): Promise<CollaboratorResult> {
  try {
    const ownerTenantIds = await getOwnerTenantIds(auth.userId);
    if (!ownerTenantIds) {
      return { ok: false, error: 'Only owners can manage invitations', status: 403 };
    }

    const { data: invitation } = await supabaseAdmin
      .from('invitations')
      .select('id, tenant_id, email, role')
      .eq('id', invitationId)
      .in('tenant_id', ownerTenantIds)
      .maybeSingle();

    if (!invitation) {
      return { ok: false, error: 'Invitation not found', status: 404 };
    }

    const { error } = await supabaseAdmin
      .from('invitations')
      .delete()
      .eq('id', invitationId)
      .in('tenant_id', ownerTenantIds);

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
