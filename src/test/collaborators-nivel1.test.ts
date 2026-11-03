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
  })),
}));

import { POST as addCollaborator } from '@/app/api/settings/collaborators/route';
import { DELETE as removeCollaborator } from '@/app/api/settings/collaborators/[id]/route';
import { DELETE as revokeInvitation } from '@/app/api/settings/invitations/[id]/route';
import { acceptInvitationsForUser } from '@/lib/accept-invitations';

const TENANT_A2 = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
const EMAIL = 'nuevo@empresa-a.com';

function ownerOf(...tenantIds: string[]) {
  return {
    data: tenantIds.map((tenant_id) => ({ tenant_id, role: 'owner' })),
    error: null,
  };
}

beforeEach(() => {
  supabaseMock.__reset();
  supabaseMock.__setTenantAware(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('colaboradores — nivel 1', () => {
  it('crea una invitación por cada sucursal elegida', async () => {
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A, TENANT_A2));
    supabaseMock.__queue('profiles', { data: null, error: null });
    // `enforceUserLimit` consulta el plan de cada sucursal; business = sin tope.
    supabaseMock.__queue('tenants', { data: { id: TENANT_A, subscription_plan: 'business' } });
    supabaseMock.__queue('tenants', { data: { id: TENANT_A2, subscription_plan: 'business' } });

    const res = await addCollaborator(
      apiRequest('http://localhost/api/settings/collaborators', 'POST', {
        email: EMAIL,
        role: 'manager',
        tenant_ids: [TENANT_A, TENANT_A2],
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tenant_ids).toEqual([TENANT_A, TENANT_A2]);

    const upserts = callsTo(supabaseMock.__calls, 'invitations', 'upsert');
    expect(upserts).toHaveLength(1);
    const rows = upserts[0].args[0] as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.tenant_id)).toEqual([TENANT_A, TENANT_A2]);
    expect(rows.every((r) => r.email === EMAIL && r.role === 'manager')).toBe(true);
  });

  it('no deja invitaciones a medias si una sucursal superó el límite', async () => {
    // Se apaga el filtro tenant-aware para que el mock conserve `count`, que es
    // lo que usa `enforceUserLimit`.
    supabaseMock.__setTenantAware(false);
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A, TENANT_A2));
    supabaseMock.__queue('profiles', { data: null, error: null });
    // A tiene lugar (business), A2 está en starter con un usuario ya cargado.
    supabaseMock.__queue('tenants', { data: { id: TENANT_A, subscription_plan: 'business' } });
    supabaseMock.__queue('tenants', { data: { id: TENANT_A2, subscription_plan: 'starter' } });
    supabaseMock.__queue('tenant_users', { data: null, error: null, count: 1 });

    const res = await addCollaborator(
      apiRequest('http://localhost/api/settings/collaborators', 'POST', {
        email: EMAIL,
        role: 'member',
        tenant_ids: [TENANT_A, TENANT_A2],
      })
    );

    expect(res.status).toBe(403);
    expect(writesTo(supabaseMock.__calls, 'invitations')).toHaveLength(0);
  });

  it('revoca solo invitaciones de las sucursales propias', async () => {
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A));
    // La invitación es de B: el filtro por tenant_id del mock la oculta.
    supabaseMock.__queue('invitations', {
      data: { id: 'inv-b', tenant_id: TENANT_B, email: 'ajeno@empresa-b.com', role: 'member' },
      error: null,
    });

    const res = await revokeInvitation(
      apiRequest('http://localhost/api/settings/invitations/inv-b', 'DELETE'),
      routeParams('inv-b')
    );

    expect(res.status).toBe(404);
    expect(writesTo(supabaseMock.__calls, 'invitations')).toHaveLength(0);
  });

  it('revoca una invitación propia', async () => {
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A));
    supabaseMock.__queue('invitations', {
      data: { id: 'inv-a', tenant_id: TENANT_A, email: EMAIL, role: 'member' },
      error: null,
    });

    const res = await revokeInvitation(
      apiRequest('http://localhost/api/settings/invitations/inv-a', 'DELETE'),
      routeParams('inv-a')
    );

    expect(res.status).toBe(200);
    const deletes = callsTo(supabaseMock.__calls, 'invitations', 'delete');
    expect(deletes).toHaveLength(1);
  });

  it('quita a la persona solo de la sucursal indicada', async () => {
    const targetUserId = 'cccccccc-3333-4333-8333-cccccccccccc';
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A, TENANT_A2));
    supabaseMock.__queue('tenant_users', {
      data: [
        { id: 'tu-a', tenant_id: TENANT_A, user_id: targetUserId, role: 'member' },
        { id: 'tu-a2', tenant_id: TENANT_A2, user_id: targetUserId, role: 'member' },
      ],
      error: null,
    });

    const res = await removeCollaborator(
      apiRequest(
        `http://localhost/api/settings/collaborators/${targetUserId}?tenant_id=${TENANT_A}`,
        'DELETE'
      ),
      routeParams(targetUserId)
    );

    expect(res.status).toBe(200);
    const deletes = callsTo(supabaseMock.__calls, 'tenant_users', 'delete');
    expect(deletes).toHaveLength(1);
    const tenantFilters = callsTo(supabaseMock.__calls, 'tenant_users', 'in')
      .filter((c) => c.args[0] === 'tenant_id');
    expect(tenantFilters.length).toBeGreaterThan(0);
    for (const filter of tenantFilters) {
      expect(filter.args[1]).toEqual([TENANT_A]);
      expect(JSON.stringify(filter.args[1])).not.toContain(TENANT_A2);
    }
  });

  it('aceptar una invitación no pisa el rol de un miembro existente', async () => {
    supabaseMock.__queue('invitations', {
      data: [{ id: 'inv-1', tenant_id: TENANT_A, role: 'member' }],
      error: null,
    });
    supabaseMock.__queue('tenant_users', {
      data: { id: 'tu-1', role: 'owner' },
      error: null,
    });

    const result = await acceptInvitationsForUser({ id: USER_A, email: EMAIL });

    expect(result.accepted).toBe(1);
    expect(callsTo(supabaseMock.__calls, 'tenant_users', 'upsert')).toHaveLength(0);
    expect(callsTo(supabaseMock.__calls, 'tenant_users', 'insert')).toHaveLength(0);
  });
});
