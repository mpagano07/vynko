import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import {
  TENANT_A,
  TENANT_B,
  USER_A,
  apiRequest,
  callsTo,
  routeParams,
  writesTo,
} from '@/test/tenant-isolation';

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

vi.mock('@/lib/api-auth', () => ({
  getAuth: vi.fn(async () => ({
    tenantId: TENANT_A,
    userId: USER_A,
    allTenants: false,
    tenantIds: [TENANT_A],
    role: 'owner',
  })),
}));

vi.mock('@/lib/activity-log', () => ({
  createActivityLog: vi.fn(async () => undefined),
}));

import { POST as addCollaborator } from '@/app/api/settings/collaborators/route';
import { PATCH as patchCollaborator } from '@/app/api/settings/collaborators/[id]/route';
import { POST as transferOwnership } from '@/app/api/settings/collaborators/[id]/transfer-ownership/route';
import { acceptInvitationsForUser, getUserTenantIds } from '@/lib/accept-invitations';

const TARGET = 'cccccccc-3333-4333-8333-cccccccccccc';
const EMAIL = 'nuevo@empresa-a.com';

function ownerOf(...tenantIds: string[]) {
  return {
    data: tenantIds.map((tenant_id) => ({ tenant_id, role: 'owner', status: 'active' })),
    error: null,
  };
}

function managerOf(...tenantIds: string[]) {
  return {
    data: tenantIds.map((tenant_id) => ({ tenant_id, role: 'manager', status: 'active' })),
    error: null,
  };
}

function existingRows(rows: { id: string; tenant_id: string; role: string; status?: string }[]) {
  return { data: rows, error: null };
}

function futureDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function pastDate() {
  return new Date(Date.now() - 60 * 1000).toISOString();
}

beforeEach(() => {
  supabaseMock.__reset();
  supabaseMock.__setTenantAware(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('colaboradores — nivel 3 (managers y ciclo de vida)', () => {
  it('un manager no puede invitar con rol manager', async () => {
    supabaseMock.__queue('tenant_users', managerOf(TENANT_A));

    const res = await addCollaborator(
      apiRequest('http://localhost/api/settings/collaborators', 'POST', {
        email: EMAIL,
        role: 'manager',
        tenant_ids: [TENANT_A],
      })
    );

    expect(res.status).toBe(403);
    expect(writesTo(supabaseMock.__calls, 'invitations')).toHaveLength(0);
  });

  it('un manager no puede asignar manager ni por memberships', async () => {
    supabaseMock.__queue('tenant_users', managerOf(TENANT_A));

    const res = await addCollaborator(
      apiRequest('http://localhost/api/settings/collaborators', 'POST', {
        email: EMAIL,
        memberships: [{ tenant_id: TENANT_A, role: 'manager' }],
      })
    );

    expect(res.status).toBe(403);
    expect(writesTo(supabaseMock.__calls, 'invitations')).toHaveLength(0);
  });

  it('un manager sólo invita a las sucursales que administra', async () => {
    supabaseMock.__queue('tenant_users', managerOf(TENANT_A));
    supabaseMock.__queue('profiles', { data: null });
    // Lectura de invitaciones pendientes (topes/cooldown).
    supabaseMock.__queue('invitations', { data: null });
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });

    const res = await addCollaborator(
      apiRequest('http://localhost/api/settings/collaborators', 'POST', {
        email: EMAIL,
        memberships: [
          { tenant_id: TENANT_A, role: 'cashier' },
          { tenant_id: TENANT_B, role: 'cashier' },
        ],
      })
    );

    expect(res.status).toBe(201);
    const upserts = callsTo(supabaseMock.__calls, 'invitations', 'upsert');
    expect(upserts).toHaveLength(1);
    const rows = upserts[0].args[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: TENANT_A, role: 'cashier' });
  });

  it('un manager no puede modificar a otro manager', async () => {
    supabaseMock.__queue('tenant_users', managerOf(TENANT_A));
    supabaseMock.__queue(
      'tenant_users',
      existingRows([{ id: 'tu-a', tenant_id: TENANT_A, role: 'manager', status: 'active' }])
    );

    const res = await patchCollaborator(
      apiRequest(`http://localhost/api/settings/collaborators/${TARGET}`, 'PATCH', {
        memberships: [{ tenant_id: TENANT_A, role: 'member' }],
      }),
      routeParams(TARGET)
    );

    expect(res.status).toBe(403);
    expect(writesTo(supabaseMock.__calls, 'tenant_users')).toHaveLength(0);
  });

  it('un manager no puede modificar al propietario', async () => {
    supabaseMock.__queue('tenant_users', managerOf(TENANT_A));
    supabaseMock.__queue(
      'tenant_users',
      existingRows([{ id: 'tu-a', tenant_id: TENANT_A, role: 'owner', status: 'active' }])
    );

    const res = await patchCollaborator(
      apiRequest(`http://localhost/api/settings/collaborators/${TARGET}`, 'PATCH', {
        memberships: [{ tenant_id: TENANT_A, role: 'viewer' }],
      }),
      routeParams(TARGET)
    );

    expect(res.status).toBe(400);
    expect(writesTo(supabaseMock.__calls, 'tenant_users')).toHaveLength(0);
  });

  it('un manager sí puede editar un rol operativo de su sucursal', async () => {
    supabaseMock.__queue('tenant_users', managerOf(TENANT_A));
    supabaseMock.__queue(
      'tenant_users',
      existingRows([{ id: 'tu-a', tenant_id: TENANT_A, role: 'member', status: 'active' }])
    );

    const res = await patchCollaborator(
      apiRequest(`http://localhost/api/settings/collaborators/${TARGET}`, 'PATCH', {
        memberships: [{ tenant_id: TENANT_A, role: 'cashier' }],
      }),
      routeParams(TARGET)
    );

    expect(res.status).toBe(200);
    const updates = callsTo(supabaseMock.__calls, 'tenant_users', 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toEqual({ role: 'cashier', status: 'active' });
  });

  it('desactivar conserva la fila y sólo cambia el estado', async () => {
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A));
    supabaseMock.__queue(
      'tenant_users',
      existingRows([{ id: 'tu-a', tenant_id: TENANT_A, role: 'cashier', status: 'active' }])
    );

    const res = await patchCollaborator(
      apiRequest(`http://localhost/api/settings/collaborators/${TARGET}`, 'PATCH', {
        status: 'inactive',
      }),
      routeParams(TARGET)
    );

    expect(res.status).toBe(200);
    const deletes = callsTo(supabaseMock.__calls, 'tenant_users', 'delete');
    expect(deletes).toHaveLength(0);
    const updates = callsTo(supabaseMock.__calls, 'tenant_users', 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toEqual({ status: 'inactive' });
    // La RPC decide si la persona sigue activa en otra sucursal. Se llama
    // siempre al desactivar; la base es la que sabe si corresponde revocar.
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'revoke_user_sessions_if_no_active_membership',
      { p_user_id: TARGET }
    );
  });

  it('desactivar no falla si la revocación de sesiones falla', async () => {
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A));
    supabaseMock.__queue(
      'tenant_users',
      existingRows([{ id: 'tu-a', tenant_id: TENANT_A, role: 'cashier', status: 'active' }])
    );
    supabaseMock.__rpcQueue('revoke_user_sessions_if_no_active_membership', {
      data: null,
      error: { message: 'rpc caida' },
    });

    const res = await patchCollaborator(
      apiRequest(`http://localhost/api/settings/collaborators/${TARGET}`, 'PATCH', {
        status: 'inactive',
      }),
      routeParams(TARGET)
    );

    // La revocación es best-effort: la membresía ya quedó inactiva y el
    // backend le niega el tenant igual. Devolver 500 haría creer al owner que
    // la desactivación no se aplicó.
    expect(res.status).toBe(200);
  });

  it('reactivar vuelve a poner la membresía en activo', async () => {
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A));
    supabaseMock.__queue(
      'tenant_users',
      existingRows([{ id: 'tu-a', tenant_id: TENANT_A, role: 'cashier', status: 'inactive' }])
    );

    const res = await patchCollaborator(
      apiRequest(`http://localhost/api/settings/collaborators/${TARGET}`, 'PATCH', {
        status: 'active',
      }),
      routeParams(TARGET)
    );

    expect(res.status).toBe(200);
    const updates = callsTo(supabaseMock.__calls, 'tenant_users', 'update');
    expect(updates[0].args[0]).toEqual({ status: 'active' });
    // Reactivar nunca revoca: no hay ninguna membresía que se haya perdido.
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      'revoke_user_sessions_if_no_active_membership',
      expect.anything()
    );
  });

  it('no se puede desactivar al propietario', async () => {
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A));
    supabaseMock.__queue(
      'tenant_users',
      existingRows([{ id: 'tu-a', tenant_id: TENANT_A, role: 'owner', status: 'active' }])
    );

    const res = await patchCollaborator(
      apiRequest(`http://localhost/api/settings/collaborators/${TARGET}`, 'PATCH', {
        status: 'inactive',
      }),
      routeParams(TARGET)
    );

    expect(res.status).toBe(400);
    expect(writesTo(supabaseMock.__calls, 'tenant_users')).toHaveLength(0);
  });

  it('un manager no puede desactivar a otro manager', async () => {
    supabaseMock.__queue('tenant_users', managerOf(TENANT_A));
    supabaseMock.__queue(
      'tenant_users',
      existingRows([{ id: 'tu-a', tenant_id: TENANT_A, role: 'manager', status: 'active' }])
    );

    const res = await patchCollaborator(
      apiRequest(`http://localhost/api/settings/collaborators/${TARGET}`, 'PATCH', {
        status: 'inactive',
      }),
      routeParams(TARGET)
    );

    expect(res.status).toBe(403);
    expect(writesTo(supabaseMock.__calls, 'tenant_users')).toHaveLength(0);
  });

  it('transfiere la propiedad con la RPC transaccional', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'owner', status: 'active' } });
    supabaseMock.__queue('tenant_users', { data: { role: 'member', status: 'active' } });
    supabaseMock.__rpcQueue('transfer_tenant_ownership', { data: null, error: null });

    const res = await transferOwnership(
      apiRequest(
        `http://localhost/api/settings/collaborators/${TARGET}/transfer-ownership`,
        'POST',
        { tenant_id: TENANT_A }
      ),
      routeParams(TARGET)
    );

    expect(res.status).toBe(200);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('transfer_tenant_ownership', {
      p_tenant_id: TENANT_A,
      p_new_owner: TARGET,
      p_actor: USER_A,
    });
  });

  it('sólo el propietario puede transferir la empresa', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'manager', status: 'active' } });

    const res = await transferOwnership(
      apiRequest(
        `http://localhost/api/settings/collaborators/${TARGET}/transfer-ownership`,
        'POST',
        { tenant_id: TENANT_A }
      ),
      routeParams(TARGET)
    );

    expect(res.status).toBe(403);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('no se transfiere la propiedad a un colaborador inactivo', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'owner', status: 'active' } });
    supabaseMock.__queue('tenant_users', { data: { role: 'member', status: 'inactive' } });

    const res = await transferOwnership(
      apiRequest(
        `http://localhost/api/settings/collaborators/${TARGET}/transfer-ownership`,
        'POST',
        { tenant_id: TENANT_A }
      ),
      routeParams(TARGET)
    );

    expect(res.status).toBe(400);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('ignora una invitación vencida', async () => {
    supabaseMock.__queue('invitations', {
      data: [
        { id: 'inv-1', tenant_id: TENANT_A, role: 'member', expires_at: pastDate() },
      ],
    });

    const result = await acceptInvitationsForUser({ id: USER_A, email: EMAIL });

    expect(result.accepted).toBe(0);
    expect(writesTo(supabaseMock.__calls, 'tenant_users')).toHaveLength(0);
    expect(writesTo(supabaseMock.__calls, 'invitations')).toHaveLength(0);
  });

  it('aceptar una invitación reactiva una membresía inactiva con el rol invitado', async () => {
    supabaseMock.__queue('invitations', {
      data: [
        { id: 'inv-1', tenant_id: TENANT_A, role: 'cashier', expires_at: futureDate() },
      ],
    });
    supabaseMock.__queue('tenant_users', {
      data: { id: 'tu-1', role: 'member', status: 'inactive' },
    });

    const result = await acceptInvitationsForUser({ id: USER_A, email: EMAIL });

    expect(result.accepted).toBe(1);
    const updates = callsTo(supabaseMock.__calls, 'tenant_users', 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toMatchObject({ role: 'cashier', status: 'active' });
  });

  it('una invitación con rol owner nunca crea otro propietario', async () => {
    supabaseMock.__queue('invitations', {
      data: [{ id: 'inv-1', tenant_id: TENANT_A, role: 'owner', expires_at: futureDate() }],
    });
    supabaseMock.__queue('tenant_users', { data: null });
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });
    supabaseMock.__queue('profiles', { data: null, error: null });

    const result = await acceptInvitationsForUser({ id: USER_A, email: EMAIL });

    expect(result.accepted).toBe(1);
    const inserts = callsTo(supabaseMock.__calls, 'tenant_users', 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toMatchObject({ tenant_id: TENANT_A, role: 'member' });
  });

  it('no pisa el tenant_id del perfil de alguien que ya tiene empresa propia', async () => {
    supabaseMock.__queue('invitations', {
      data: [{ id: 'inv-1', tenant_id: TENANT_A, role: 'cashier', expires_at: futureDate() }],
    });
    supabaseMock.__queue('tenant_users', { data: null });
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });
    supabaseMock.__queue('profiles', {
      data: { id: USER_A, tenant_id: TENANT_B },
      error: null,
    });

    const result = await acceptInvitationsForUser({ id: USER_A, email: EMAIL });

    expect(result.accepted).toBe(1);
    const upserts = callsTo(supabaseMock.__calls, 'profiles', 'upsert');
    expect(upserts).toHaveLength(1);
    // El upsert SIEMPRE manda `tenant_id` porque la columna es NOT NULL y
    // Postgres valida la tupla del INSERT antes del ON CONFLICT. Si se omite,
    // la aceptación falla con 23502 y la membresía nunca se crea.
    expect(upserts[0].args[0]).toMatchObject({ tenant_id: TENANT_B });
    // La membresía real sigue siendo la que resuelve el acceso.
    expect(callsTo(supabaseMock.__calls, 'tenant_users', 'insert')[0].args[0]).toMatchObject({
      tenant_id: TENANT_A,
      role: 'cashier',
    });
  });

  it('completa el tenant_id del perfil cuando todavía no tiene ninguno', async () => {
    supabaseMock.__queue('invitations', {
      data: [{ id: 'inv-1', tenant_id: TENANT_A, role: 'member', expires_at: futureDate() }],
    });
    supabaseMock.__queue('tenant_users', { data: null });
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' } });
    supabaseMock.__queue('profiles', { data: null, error: null });

    const result = await acceptInvitationsForUser({ id: USER_A, email: EMAIL });

    expect(result.accepted).toBe(1);
    const upserts = callsTo(supabaseMock.__calls, 'profiles', 'upsert');
    expect(upserts[0].args[0]).toMatchObject({ id: USER_A, tenant_id: TENANT_A });
  });

  it('no reactiva por invitación a un owner inactivo', async () => {
    supabaseMock.__queue('invitations', {
      data: [{ id: 'inv-1', tenant_id: TENANT_A, role: 'member', expires_at: futureDate() }],
    });
    supabaseMock.__queue('tenant_users', {
      data: { id: 'tu-1', role: 'owner', status: 'inactive' },
    });

    const result = await acceptInvitationsForUser({ id: USER_A, email: EMAIL });

    expect(result.accepted).toBe(1);
    expect(callsTo(supabaseMock.__calls, 'tenant_users', 'update')).toHaveLength(0);
  });

  it('las membresías inactivas no cuentan como acceso', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: TENANT_A }] });

    const tenantIds = await getUserTenantIds(USER_A);

    expect(tenantIds).toEqual([TENANT_A]);
    const statusFilters = callsTo(supabaseMock.__calls, 'tenant_users', 'eq').filter(
      (c) => c.args[0] === 'status'
    );
    expect(statusFilters).toHaveLength(1);
    expect(statusFilters[0].args[1]).toBe('active');
  });

  it('el listado incluye el estado de cada sucursal', async () => {
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A));
    supabaseMock.__queue('tenant_users', {
      data: [
        {
          id: 'tu-a',
          user_id: TARGET,
          tenant_id: TENANT_A,
          role: 'cashier',
          status: 'inactive',
          joined_at: '2026-01-01',
        },
      ],
    });
    supabaseMock.__queue('profiles', {
      data: [{ id: TARGET, email: EMAIL, full_name: 'Ana', avatar_url: null }],
    });
    supabaseMock.__queue('tenants', { data: [{ id: TENANT_A, name: 'Sucursal A' }] });
    supabaseMock.__queue('invitations', { data: [] });

    const { GET } = await import('@/app/api/settings/collaborators/route');
    const res = await GET(apiRequest('http://localhost/api/settings/collaborators', 'GET'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.collaborators[0].active).toBe(false);
    expect(body.collaborators[0].memberships[0]).toMatchObject({
      tenant_id: TENANT_A,
      status: 'inactive',
    });
  });
});
