import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { PLAN_LIMITS, NEW_ACCOUNT_PLAN } from '@/lib/plans';
import type { AuthInfo } from '@/lib/api-auth';
import type { PlanId } from '@/lib/plans';
import { logger } from '@/lib/logger';

export type CollaboratorResult =
  | { ok: true; body: unknown; status: number }
  | { ok: false; error: string; status: number };

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
    for (const m of allMembers) {
      const uid = m.user_id as string;
      if (!userTenants[uid]) userTenants[uid] = [];
      if (!userTus[uid]) userTus[uid] = [];
      const tn = tenantMap.get(m.tenant_id as string);
      if (tn) userTenants[uid].push({ id: tn.id, name: tn.name });
      userTus[uid].push(m.id as string);
      if (m.role === 'owner') userRoles[uid] = 'owner';
      else if (m.role === 'manager' && userRoles[uid] !== 'owner') userRoles[uid] = 'manager';
      else if (!userRoles[uid]) userRoles[uid] = m.role || 'member';
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
      };
    });

    const { data: pendingInvitations } = await supabaseAdmin
      .from('invitations')
      .select('id, email, role, created_at')
      .in('tenant_id', ownerTenantIds)
      .is('accepted_at', null);

    return {
      ok: true,
      body: { collaborators, pendingInvitations: pendingInvitations || [] },
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

    const { email, role, tenant_ids, full_name } = body;

    if (!email || typeof email !== 'string') {
      return { ok: false, error: 'Email is required', status: 400 };
    }

    const targetTenantIds: string[] = Array.isArray(tenant_ids) && tenant_ids.length > 0
      ? tenant_ids.filter((id: string) => ownerTenantIds.includes(id))
      : ownerTenantIds;

    if (targetTenantIds.length === 0) {
      return { ok: false, error: 'No valid tenants selected', status: 400 };
    }

    const validRoles = ['manager', 'member'];
    const assignRole = validRoles.includes(role ?? '') ? role : 'member';
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
        return inviteByEmail(auth, email.toLowerCase(), assignRole, origin);
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

      for (const tid of targetTenantIds) {
        const { data: existingMember } = await supabaseAdmin
          .from('tenant_users')
          .select('id')
          .eq('tenant_id', tid)
          .eq('user_id', existingProfile.id)
          .maybeSingle();

        if (!existingMember) {
          const limitError = await enforceUserLimit(tid);
          if (limitError) {
            return { ok: false, error: limitError, status: 403 };
          }
          const { error: insertError } = await supabaseAdmin
            .from('tenant_users')
            .insert({ tenant_id: tid, user_id: existingProfile.id, role: assignRole });
          if (insertError) {
            logger.error(`Error adding to tenant ${tid}:`, { error: insertError });
          }
        }
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

    return inviteByEmail(auth, email.toLowerCase(), assignRole, origin);
  } catch (err) {
    logger.error('Error adding collaborator:', { error: err });
    return { ok: false, error: 'Internal server error', status: 500 };
  }
}

/**
 * Crea la invitacion pendiente y manda el email. El invitado entra a
 * `tenant_users` recien cuando acepta (`acceptInvitationsForUser`), que es lo
 * que convierte el alta de un desconocido en algo que solo pasa con su venia.
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
  role: string,
  origin: string
): Promise<CollaboratorResult> {
  const ownerTenantIds = await getOwnerTenantIds(auth.userId);
  if (!ownerTenantIds) {
    return { ok: false, error: 'Only owners can manage collaborators', status: 403 };
  }

  const inviteTenantId = ownerTenantIds[0];
  const limitError = await enforceUserLimit(inviteTenantId);
  if (limitError) {
    return { ok: false, error: limitError, status: 403 };
  }

  const { error: inviteError } = await supabaseAdmin.from('invitations').upsert(
    {
      tenant_id: inviteTenantId,
      email,
      role,
      invited_by: auth.userId,
    },
    { onConflict: 'tenant_id,email' }
  );

  if (inviteError) {
    logger.error('DB error:', { error: inviteError });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/accept-invite`,
  });

  return {
    ok: true,
    status: 201,
    body: {
      invited: true,
      email,
      message: 'Invitación enviada por email.',
    },
  };
}

export async function updateCollaborator(
  auth: AuthInfo,
  targetUserId: string,
  body: { role?: string; tenant_ids?: string[] }
): Promise<CollaboratorResult> {
  try {
    const ownerTenantIds = await getOwnerTenantIds(auth.userId);
    if (!ownerTenantIds) {
      return { ok: false, error: 'Only owners can edit collaborators', status: 403 };
    }

    if (targetUserId === auth.userId) {
      return { ok: false, error: 'No podés editar tu propio rol', status: 400 };
    }

    const { role, tenant_ids } = body;

    const validRoles = ['manager', 'member'];
    const newRole = validRoles.includes(role ?? '') ? role : 'member';
    const targetTenantIds: string[] = Array.isArray(tenant_ids)
      ? [...new Set(tenant_ids.filter((id: string) => ownerTenantIds.includes(id)))]
      : ownerTenantIds;

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
    const toRemoveTenantIds = currentTenantIds.filter((id) => !targetTenantIds.includes(id));
    const toAddTenantIds = targetTenantIds.filter((id) => !currentTenantIds.includes(id));

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
          role: newRole,
        })));
      if (error) {
        logger.error('DB error:', { error });
        return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('tenant_users')
      .update({ role: newRole })
      .eq('user_id', targetUserId)
      .in('tenant_id', currentTenantIds.filter((id) => !toRemoveTenantIds.includes(id)))
      .neq('role', 'owner');

    if (updateError) {
      logger.error('DB error:', { error: updateError });
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }

    return { ok: true, body: { success: true }, status: 200 };
  } catch (err) {
    logger.error('Error editing collaborator:', { error: err });
    return { ok: false, error: 'Internal server error', status: 500 };
  }
}

export async function deleteCollaborator(auth: AuthInfo, id: string): Promise<CollaboratorResult> {
  try {
    const ownerTenantIds = await getOwnerTenantIds(auth.userId);
    if (!ownerTenantIds) {
      return { ok: false, error: 'Only owners can remove collaborators', status: 403 };
    }

    const { data: target } = await supabaseAdmin
      .from('tenant_users')
      .select('role, user_id')
      .eq('id', id)
      .in('tenant_id', ownerTenantIds)
      .single();

    if (!target) {
      return { ok: false, error: 'Collaborator not found', status: 404 };
    }

    if (target.role === 'owner') {
      return { ok: false, error: 'Cannot remove the owner', status: 400 };
    }

    const { error } = await supabaseAdmin
      .from('tenant_users')
      .delete()
      .eq('user_id', target.user_id as string)
      .in('tenant_id', ownerTenantIds)
      .neq('role', 'owner');

    if (error) {
      logger.error('DB error:', { error });
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }

    return { ok: true, body: { success: true }, status: 200 };
  } catch (err) {
    logger.error('Error removing collaborator:', { error: err });
    return { ok: false, error: 'Internal server error', status: 500 };
  }
}
