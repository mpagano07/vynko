import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import {
  FOREIGN_ID,
  TENANT_A,
  TENANT_B,
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
    userId: '11111111-1111-4111-8111-111111111111',
    allTenants: false,
    tenantIds: [TENANT_A],
  })),
}));

import { GET as listCollaborators, POST as addCollaborator } from '@/app/api/settings/collaborators/route';
import { PATCH as editCollaborator, DELETE as removeCollaborator } from '@/app/api/settings/collaborators/[id]/route';

const USER_OF_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const EMAIL_OF_B = 'empleado@empresa-b.com';

/** `getOwnerTenantIds`: A es owner. */
const ownerOfA = { data: [{ tenant_id: TENANT_A, role: 'owner' }], error: null as unknown };

beforeEach(() => {
  supabaseMock.__reset();
  supabaseMock.__setTenantAware(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('usuarios y colaboradores', () => {
  it('no renombra el perfil global de un empleado de B', async () => {
    // `profiles` es una tabla global: el empleado existe una sola vez y puede
    // trabajar solo en B. Si al invitarlo A le pisa `full_name`, el owner de A
    // escribe datos de identidad de una persona de otra empresa.
    supabaseMock.__queue('tenant_users', ownerOfA);
    supabaseMock.__queue('profiles', {
      data: { id: USER_OF_B, email: EMAIL_OF_B, tenant_id: TENANT_B },
      error: null,
    });
    // La persona existe y trabaja unicamente en B.
    supabaseMock.__queue('tenant_users', {
      data: [{ id: 'tu-b', tenant_id: TENANT_B, user_id: USER_OF_B, role: 'member' }],
      error: null,
    });
    supabaseMock.__queue('tenant_users', { data: null, error: null });
    supabaseMock.__queue('tenants', {
      data: { id: TENANT_A, subscription_plan: 'pro' },
      error: null,
    });
    supabaseMock.__queue('tenant_users', { data: [], error: null });
    supabaseMock.__queue('tenant_users', { data: null, error: null });
    supabaseMock.__queue('profiles', {
      data: { id: USER_OF_B, email: EMAIL_OF_B, full_name: 'Nombre original' },
      error: null,
    });

    const res = await addCollaborator(
      apiRequest('http://localhost/api/settings/collaborators', 'POST', {
        email: EMAIL_OF_B,
        full_name: 'Nombre inventado por A',
      })
    );

    expect(writesTo(supabaseMock.__calls, 'profiles')).toHaveLength(0);
    expect(res.status).toBeLessThan(500);
  });

  it('no puede editar a un usuario que solo trabaja en B', async () => {
    supabaseMock.__queue('tenant_users', ownerOfA);
    // B no esta entre los ownerTenantIds: la fila no llega y el servicio 404ea.
    supabaseMock.__queue('tenant_users', [
      { id: 'tu-b', tenant_id: TENANT_B, role: 'member' },
    ] as never);

    const res = await editCollaborator(
      apiRequest(`http://localhost/api/settings/collaborators/${USER_OF_B}`, 'PATCH', {
        role: 'manager',
      }),
      routeParams(USER_OF_B)
    );

    expect(res.status).toBe(404);
    expect(writesTo(supabaseMock.__calls, 'tenant_users')).toHaveLength(0);
  });

  it('no elimina la membresia de B de un usuario ajeno', async () => {
    supabaseMock.__queue('tenant_users', ownerOfA);
    supabaseMock.__queue('tenant_users', [
      { id: FOREIGN_ID, tenant_id: TENANT_B, role: 'member' },
    ] as never);

    const res = await removeCollaborator(
      apiRequest(`http://localhost/api/settings/collaborators/${FOREIGN_ID}`, 'DELETE'),
      routeParams(FOREIGN_ID)
    );

    expect(res.status).not.toBe(200);
    const deletes = callsTo(supabaseMock.__calls, 'tenant_users', 'delete');
    expect(deletes).toHaveLength(0);
  });

  it('el listado de colaboradores no incluye miembros de B', async () => {
    supabaseMock.__queue('tenant_users', ownerOfA);
    supabaseMock.__queue('tenant_users', [
      { id: 'tu-a', user_id: 'user-a', role: 'owner', tenant_id: TENANT_A },
    ] as never);
    supabaseMock.__queue('profiles', [
      { id: 'user-a', email: 'owner@empresa-a.com', full_name: 'Owner de A' },
    ] as never);
    supabaseMock.__queue('tenants', [
      { id: TENANT_A, name: 'Empresa A' },
    ] as never);
    supabaseMock.__queue('invitations', [
      { id: 'inv-b', email: EMAIL_OF_B, role: 'member', tenant_id: TENANT_B },
    ] as never);

    const res = await listCollaborators(apiRequest('http://localhost/api/settings/collaborators', 'GET'));
    const raw = await res.text();

    expect(raw).not.toContain(EMAIL_OF_B);
    expect(raw).not.toContain('inv-b');
  });

  it('no puede invitar a un miembro de otra empresa inyectando su tenant_id', async () => {
    supabaseMock.__queue('tenant_users', ownerOfA);
    supabaseMock.__queue('profiles', { data: null, error: null });

    const res = await addCollaborator(
      apiRequest('http://localhost/api/settings/collaborators', 'POST', {
        email: 'nuevo@empresa-a.com',
        tenant_ids: [TENANT_B],
      })
    );

    expect(JSON.stringify(supabaseMock.__calls)).not.toContain(TENANT_B);
    expect(res.status).toBeLessThan(500);
  });
});