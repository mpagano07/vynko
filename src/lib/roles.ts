/**
 * Definiciones de roles compartidas por cliente y servidor.
 *
 * Este archivo NO puede importar nada del servidor (`supabaseAdmin`, etc.):
 * lo consumen componentes `'use client'`. Las etiquetas y descripciones viven
 * acá para que la UI y los servicios no cuenten historias distintas sobre lo
 * que puede hacer cada rol.
 *
 * En el Nivel 2 esto se convierte en una matriz de capabilities; por ahora son
 * los tres roles que ya existen en `tenant_users.role`.
 */
export type TenantRole = 'owner' | 'manager' | 'member';

/** Roles que se pueden asignar desde Colaboradores (el owner no se transfiere). */
export const ASSIGNABLE_ROLES: TenantRole[] = ['manager', 'member'];

/** Roles con permiso de operar y administrar (no solo consultar). */
export const MANAGE_ROLES: TenantRole[] = ['owner', 'manager'];

export const ROLE_LABELS: Record<TenantRole, string> = {
  owner: 'Propietario',
  manager: 'Manager',
  member: 'Miembro',
};

/**
 * Descripción honesta de lo que cada rol puede hacer hoy. Si cambia un gate de
 * permisos, esta descripción tiene que cambiar con él.
 */
export const ROLE_DESCRIPTIONS: Record<TenantRole, string> = {
  owner: 'Control total: empresa, sucursales, colaboradores, facturación y plan.',
  manager:
    'Además de vender, opera la caja y administra productos, precios, compras, transferencias y cobros.',
  member:
    'Registra ventas y consulta productos, clientes y documentos. No opera la caja ni administra el catálogo.',
};

/** Guía corta para el selector de rol. */
export const ROLE_OPTIONS = ASSIGNABLE_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
  description: ROLE_DESCRIPTIONS[role],
}));

export function getRoleLabel(role: string | null | undefined): string {
  return ROLE_LABELS[(role as TenantRole) ?? 'member'] ?? 'Miembro';
}
