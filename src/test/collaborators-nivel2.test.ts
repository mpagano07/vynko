import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import {
  TENANT_A,
  TENANT_B,
  USER_A,
  apiRequest,
  callsTo,
  routeParams,
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
import { PATCH as updateCollaborator } from '@/app/api/settings/collaborators/[id]/route';

const TENANT_A2 = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
const TARGET = 'cccccccc-3333-4333-8333-cccccccccccc';
const EMAIL = 'nuevo@empresa-a.com';

function ownerOf(...tenantIds: string[]) {
  return {
    data: tenantIds.map((tenant_id) => ({ tenant_id, role: 'owner' })),
    error: null,
  };
}

function existingRows(rows: { id: string; tenant_id: string; role: string }[]) {
  return { data: rows, error: null };
}

function inFilters() {
  return callsTo(supabaseMock.__calls, 'tenant_users', 'in').filter(
    (c) => c.args[0] === 'tenant_id'
  );
}

beforeEach(() => {
  supabaseMock.__reset();
  supabaseMock.__setTenantAware(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('colaboradores — nivel 2 (rol por sucursal)', () => {
  it('da de alta con un rol distinto por sucursal', async () => {
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A, TENANT_A2));
    // La persona ya existe y ya es de la casa: se agrega directo.
    supabaseMock.__queue('profiles', { data: { id: TARGET } });
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: TENANT_A }] });
    // No es miembro todavía de ninguna de las dos sucursales destino.
    supabaseMock.__queue('tenant_users', { data: null });
    supabaseMock.__queue('tenant_users', { data: null });
    supabaseMock.__queue('tenants', { data: { id: TENANT_A, subscription_plan: 'business' } });
    supabaseMock.__queue('tenants', { data: { id: TENANT_A2, subscription_plan: 'business' } });
    supabaseMock.__queue('profiles', {
      data: { email: EMAIL, full_name: '', avatar_url: null },
    });

    const res = await addCollaborator(
      apiRequest('http://localhost/api/settings/collaborators', 'POST', {
        email: EMAIL,
        memberships: [
          { tenant_id: TENANT_A, role: 'cashier' },
          { tenant_id: TENANT_A2, role: 'viewer' },
        ],
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    // El rol principal es el de mayor alcance de las sucursales.
    expect(body.collaborator.role).toBe('cashier');

    const inserts = callsTo(supabaseMock.__calls, 'tenant_users', 'insert');
    expect(inserts.map((c) => (c.args[0] as { role: string }).role)).toEqual([
      'cashier',
      'viewer',
    ]);
  });

  it('ignora sucursales ajenas al owner', async () => {
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A));
    supabaseMock.__queue('profiles', { data: { id: TARGET } });
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: TENANT_A }] });
    supabaseMock.__queue('tenant_users', { data: null });
    supabaseMock.__queue('tenants', { data: { id: TENANT_A, subscription_plan: 'business' } });
    supabaseMock.__queue('profiles', {
      data: { email: EMAIL, full_name: '', avatar_url: null },
    });

    const res = await addCollaborator(
      apiRequest('http://localhost/api/settings/collaborators', 'POST', {
        email: EMAIL,
        memberships: [
          { tenant_id: TENANT_A, role: 'stock' },
          { tenant_id: TENANT_B, role: 'manager' },
        ],
      })
    );

    expect(res.status).toBe(201);
    const inserts = callsTo(supabaseMock.__calls, 'tenant_users', 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toMatchObject({ tenant_id: TENANT_A, role: 'stock' });
  });

  it('actualiza solo la sucursal cuyo rol cambió', async () => {
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A, TENANT_A2));
    supabaseMock.__queue(
      'tenant_users',
      existingRows([
        { id: 'tu-a', tenant_id: TENANT_A, role: 'manager' },
        { id: 'tu-a2', tenant_id: TENANT_A2, role: 'member' },
      ])
    );

    const res = await updateCollaborator(
      apiRequest(`http://localhost/api/settings/collaborators/${TARGET}`, 'PATCH', {
        memberships: [
          { tenant_id: TENANT_A, role: 'manager' },
          { tenant_id: TENANT_A2, role: 'viewer' },
        ],
      }),
      routeParams(TARGET)
    );

    expect(res.status).toBe(200);
    const updates = callsTo(supabaseMock.__calls, 'tenant_users', 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toEqual({ role: 'viewer', status: 'active' });
    // La última consulta `in` es el filtro del update: solo A2.
    expect(inFilters().at(-1)?.args[1]).toEqual([TENANT_A2]);
    expect(callsTo(supabaseMock.__calls, 'tenant_users', 'delete')).toHaveLength(0);
    expect(callsTo(supabaseMock.__calls, 'tenant_users', 'insert')).toHaveLength(0);
  });

  it('da de baja una sucursal y le cambia el rol a la que queda', async () => {
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A, TENANT_A2));
    supabaseMock.__queue(
      'tenant_users',
      existingRows([
        { id: 'tu-a', tenant_id: TENANT_A, role: 'manager' },
        { id: 'tu-a2', tenant_id: TENANT_A2, role: 'viewer' },
      ])
    );

    const res = await updateCollaborator(
      apiRequest(`http://localhost/api/settings/collaborators/${TARGET}`, 'PATCH', {
        memberships: [{ tenant_id: TENANT_A, role: 'cashier' }],
      }),
      routeParams(TARGET)
    );

    expect(res.status).toBe(200);
    const deletes = callsTo(supabaseMock.__calls, 'tenant_users', 'delete');
    expect(deletes).toHaveLength(1);
    // El filtro de la baja es la sucursal removida (A2), no la que queda.
    expect(inFilters().at(-2)?.args[1]).toEqual([TENANT_A2]);
    const updates = callsTo(supabaseMock.__calls, 'tenant_users', 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toEqual({ role: 'cashier', status: 'active' });
    expect(inFilters().at(-1)?.args[1]).toEqual([TENANT_A]);
  });

  it('sigue aceptando el payload histórico role + tenant_ids', async () => {
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A, TENANT_A2));
    supabaseMock.__queue(
      'tenant_users',
      existingRows([
        { id: 'tu-a', tenant_id: TENANT_A, role: 'member' },
        { id: 'tu-a2', tenant_id: TENANT_A2, role: 'member' },
      ])
    );

    const res = await updateCollaborator(
      apiRequest(`http://localhost/api/settings/collaborators/${TARGET}`, 'PATCH', {
        role: 'manager',
        tenant_ids: [TENANT_A2],
      }),
      routeParams(TARGET)
    );

    expect(res.status).toBe(200);
    const deletes = callsTo(supabaseMock.__calls, 'tenant_users', 'delete');
    expect(deletes).toHaveLength(1);
    expect(inFilters().at(-2)?.args[1]).toEqual([TENANT_A]);
    const updates = callsTo(supabaseMock.__calls, 'tenant_users', 'update');
    expect(updates[0].args[0]).toEqual({ role: 'manager', status: 'active' });
    expect(inFilters().at(-1)?.args[1]).toEqual([TENANT_A2]);
  });

  it('un rol no asignable cae a member en vez de romper el CHECK', async () => {
    supabaseMock.__queue('tenant_users', ownerOf(TENANT_A));
    supabaseMock.__queue(
      'tenant_users',
      existingRows([{ id: 'tu-a', tenant_id: TENANT_A, role: 'member' }])
    );

    const res = await updateCollaborator(
      apiRequest(`http://localhost/api/settings/collaborators/${TARGET}`, 'PATCH', {
        memberships: [{ tenant_id: TENANT_A, role: 'owner' }],
      }),
      routeParams(TARGET)
    );

    expect(res.status).toBe(200);
    // Ya era member: no hay update, pero tampoco se escribió un rol inválido.
    expect(callsTo(supabaseMock.__calls, 'tenant_users', 'update')).toHaveLength(0);
  });
});
