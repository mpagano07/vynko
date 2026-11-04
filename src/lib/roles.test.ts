import { describe, expect, it } from 'vitest';
import {
  ASSIGNABLE_ROLES,
  MANAGER_ASSIGNABLE_ROLES,
  ROLE_LABELS,
  assignableRolesFor,
  canAssignRole,
  canManageCollaboratorRole,
  canManageTeam,
  getCapabilities,
  getRoleLabel,
  hasCapability,
  highestRole,
  isTenantRole,
  normalizeAssignableRole,
} from './roles';

describe('matriz de roles y capacidades', () => {
  it('owner y manager pueden todo', () => {
    for (const role of ['owner', 'manager'] as const) {
      expect(getCapabilities(role)).toEqual(
        expect.arrayContaining([
          'manage_tenant',
          'manage_catalog',
          'manage_purchases',
          'manage_documents',
          'manage_stock',
          'sell',
          'operate_cash',
          'view_reports',
          'view',
        ])
      );
    }
  });

  it('cajero vende y opera la caja, pero no administra', () => {
    expect(hasCapability('cashier', 'sell')).toBe(true);
    expect(hasCapability('cashier', 'operate_cash')).toBe(true);
    expect(hasCapability('cashier', 'manage_catalog')).toBe(false);
    expect(hasCapability('cashier', 'manage_stock')).toBe(false);
    expect(hasCapability('cashier', 'manage_tenant')).toBe(false);
  });

  it('depósito administra catálogo, compras y stock, pero no vende ni mueve caja', () => {
    expect(hasCapability('stock', 'manage_catalog')).toBe(true);
    expect(hasCapability('stock', 'manage_purchases')).toBe(true);
    expect(hasCapability('stock', 'manage_stock')).toBe(true);
    expect(hasCapability('stock', 'view_reports')).toBe(true);
    expect(hasCapability('stock', 'sell')).toBe(false);
    expect(hasCapability('stock', 'operate_cash')).toBe(false);
  });

  it('consulta solo lee', () => {
    expect(getCapabilities('viewer').sort()).toEqual(['view', 'view_reports']);
    expect(hasCapability('viewer', 'view_reports')).toBe(true);
    expect(hasCapability('viewer', 'sell')).toBe(false);
    expect(hasCapability('viewer', 'manage_stock')).toBe(false);
  });

  it('miembro conserva venta y ajuste de stock sin catálogo ni caja', () => {
    expect(hasCapability('member', 'sell')).toBe(true);
    expect(hasCapability('member', 'manage_stock')).toBe(true);
    expect(hasCapability('member', 'manage_catalog')).toBe(false);
    expect(hasCapability('member', 'operate_cash')).toBe(false);
    expect(hasCapability('member', 'manage_tenant')).toBe(false);
  });

  it('un rol desconocido no tiene capacidades', () => {
    expect(hasCapability(null, 'view')).toBe(false);
    expect(hasCapability('owner-fake', 'manage_tenant')).toBe(false);
    expect(getCapabilities('admin')).toEqual([]);
    expect(isTenantRole('admin')).toBe(false);
  });

  it('el owner no se puede asignar desde colaboradores', () => {
    expect(ASSIGNABLE_ROLES).not.toContain('owner');
    expect(ASSIGNABLE_ROLES).toEqual(
      expect.arrayContaining(['manager', 'cashier', 'stock', 'viewer', 'member'])
    );
  });

  it('etiqueta los cinco roles asignables', () => {
    expect(getRoleLabel('cashier')).toBe('Cajero');
    expect(getRoleLabel('stock')).toBe('Depósito');
    expect(getRoleLabel('viewer')).toBe('Consulta');
    expect(getRoleLabel('desconocido')).toBe(ROLE_LABELS.member);
  });

  it('highestRole elige el rol de mayor alcance entre sucursales', () => {
    expect(highestRole(['viewer', 'cashier', 'member'])).toBe('cashier');
    expect(highestRole(['stock', 'viewer'])).toBe('stock');
    expect(highestRole(['member', null, undefined])).toBe('member');
    expect(highestRole(['viewer', 'manager'])).toBe('manager');
    expect(highestRole(['owner', 'manager'])).toBe('owner');
  });

  it('normaliza roles que llegan del cliente o de una invitación', () => {
    expect(normalizeAssignableRole('cashier')).toBe('cashier');
    expect(normalizeAssignableRole('manager')).toBe('manager');
    expect(normalizeAssignableRole('owner')).toBe('member');
    expect(normalizeAssignableRole('admin')).toBe('member');
    expect(normalizeAssignableRole(null)).toBe('member');
    expect(normalizeAssignableRole(undefined)).toBe('member');
  });

  it('el owner puede asignar managers y el manager no', () => {
    expect(MANAGER_ASSIGNABLE_ROLES).not.toContain('manager');
    expect(assignableRolesFor('owner')).toEqual(expect.arrayContaining(['manager', 'cashier']));
    expect(assignableRolesFor('manager')).toEqual(
      expect.arrayContaining(['cashier', 'stock', 'viewer', 'member'])
    );
    expect(assignableRolesFor('manager')).not.toContain('manager');
    expect(assignableRolesFor('cashier')).toEqual([]);
    expect(assignableRolesFor(null)).toEqual([]);

    expect(canAssignRole('owner', 'manager')).toBe(true);
    expect(canAssignRole('manager', 'manager')).toBe(false);
    expect(canAssignRole('manager', 'cashier')).toBe(true);
    expect(canAssignRole('cashier', 'cashier')).toBe(false);
    expect(canAssignRole('owner', 'owner')).toBe(false);
  });

  it('un manager no administra owners ni a otros managers', () => {
    expect(canManageCollaboratorRole('owner', 'manager')).toBe(true);
    expect(canManageCollaboratorRole('owner', 'owner')).toBe(false);
    expect(canManageCollaboratorRole('manager', 'cashier')).toBe(true);
    expect(canManageCollaboratorRole('manager', 'manager')).toBe(false);
    expect(canManageCollaboratorRole('manager', 'owner')).toBe(false);
    expect(canManageCollaboratorRole('cashier', 'member')).toBe(false);
    expect(canManageCollaboratorRole(null, 'member')).toBe(false);
  });

  it('sólo owner y manager administran el equipo', () => {
    expect(canManageTeam('owner')).toBe(true);
    expect(canManageTeam('manager')).toBe(true);
    expect(canManageTeam('cashier')).toBe(false);
    expect(canManageTeam('stock')).toBe(false);
    expect(canManageTeam('viewer')).toBe(false);
    expect(canManageTeam('member')).toBe(false);
    expect(canManageTeam(null)).toBe(false);
  });
});
