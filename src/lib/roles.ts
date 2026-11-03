/**
 * Definiciones de roles y capacidades compartidas por cliente y servidor.
 *
 * Este archivo NO puede importar nada del servidor (`supabaseAdmin`, etc.):
 * lo consumen componentes `'use client'`. Las etiquetas, descripciones y la
 * matriz de permisos viven acá para que la UI y los servicios no cuenten
 * historias distintas sobre lo que puede hacer cada rol.
 *
 * El modelo es aditivo: cada rol tiene un conjunto de capacidades y los gates
 * del backend preguntan por la capacidad, no por el nombre del rol. Agregar un
 * rol nuevo es agregar una fila acá; no hay que tocar cada servicio.
 */
export type TenantRole = 'owner' | 'manager' | 'cashier' | 'stock' | 'viewer' | 'member';

/** Capacidades que la app sabe controlar hoy. */
export type Capability =
  /** Empresa, sucursales, plan, facturación y colaboradores. */
  | 'manage_tenant'
  /** Catálogo: productos, precios y categorías. */
  | 'manage_catalog'
  /** Proveedores, pedidos de compra y transferencias entre sucursales. */
  | 'manage_purchases'
  /** Documentos comerciales y facturación electrónica. */
  | 'manage_documents'
  /** Ajustes de stock y baja lógica de productos. */
  | 'manage_stock'
  /** Registrar ventas. */
  | 'sell'
  /** Abrir/cerrar caja y registrar movimientos de caja. */
  | 'operate_cash'
  /** Ver dashboard, reportes y actividad de la sucursal. */
  | 'view_reports'
  /** Lectura general. */
  | 'view';

const ALL_CAPABILITIES: Capability[] = [
  'manage_tenant',
  'manage_catalog',
  'manage_purchases',
  'manage_documents',
  'manage_stock',
  'sell',
  'operate_cash',
  'view_reports',
  'view',
];

/**
 * Matriz rol → capacidades.
 *
 * `member` conserva las capacidades que ya tenía antes de existir los roles
 * nuevos: vende y puede ajustar stock / dar de baja un producto, pero no
 * administra el catálogo ni mueve la caja.
 */
const ROLE_CAPABILITIES: Record<TenantRole, Capability[]> = {
  owner: ALL_CAPABILITIES,
  manager: ALL_CAPABILITIES,
  cashier: ['sell', 'operate_cash', 'view'],
  stock: ['manage_catalog', 'manage_purchases', 'manage_stock', 'view_reports', 'view'],
  viewer: ['view_reports', 'view'],
  member: ['sell', 'manage_stock', 'view'],
};

/** Roles que se pueden asignar desde Colaboradores (el owner no se transfiere). */
export const ASSIGNABLE_ROLES: TenantRole[] = [
  'manager',
  'cashier',
  'stock',
  'viewer',
  'member',
];

/**
 * Roles que puede asignar un manager. Sí puede repartir trabajo operativo,
 * pero no crear pares: si pudiera nombrar managers, un manager podría armarse
 * un equipo con los mismos permisos que él y escalar sin pasar por el owner.
 */
export const MANAGER_ASSIGNABLE_ROLES: TenantRole[] = ASSIGNABLE_ROLES.filter(
  (role) => role !== 'manager'
);

/** Roles con permiso para administrar la empresa (settings, plan, sucursales). */
export const MANAGE_ROLES: TenantRole[] = ['owner', 'manager'];

/**
 * Normaliza un rol que llega del cliente o de una invitación. Sólo se aceptan
 * roles asignables: el `owner` no se transfiere por esta vía y un valor
 * desconocido cae a `member` en vez de romper el CHECK de la base.
 */
export function normalizeAssignableRole(
  role: string | null | undefined
): TenantRole {
  return isTenantRole(role) && ASSIGNABLE_ROLES.includes(role) ? role : 'member';
}

/** ¿Este rol puede administrar el equipo de una sucursal? */
export function canManageTeam(role: string | null | undefined): boolean {
  return hasCapability(role, 'manage_tenant');
}

/** Roles que `actorRole` puede asignar en una sucursal. */
export function assignableRolesFor(
  actorRole: string | null | undefined
): TenantRole[] {
  if (actorRole === 'owner') return [...ASSIGNABLE_ROLES];
  if (actorRole === 'manager') return [...MANAGER_ASSIGNABLE_ROLES];
  return [];
}

/**
 * ¿`actorRole` puede modificar la membresía de alguien con `targetRole`?
 * El owner manda sobre todos salvo otro owner (la propiedad se transfiere,
 * no se edita). El manager no toca owners ni a otros managers.
 */
export function canManageCollaboratorRole(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined
): boolean {
  if (!isTenantRole(targetRole) || targetRole === 'owner') return false;
  if (actorRole === 'owner') return true;
  if (actorRole === 'manager') return targetRole !== 'manager';
  return false;
}

/** ¿`actorRole` puede asignar `role` en una sucursal? */
export function canAssignRole(
  actorRole: string | null | undefined,
  role: string | null | undefined
): boolean {
  return isTenantRole(role) && assignableRolesFor(actorRole).includes(role);
}

export const ROLE_LABELS: Record<TenantRole, string> = {
  owner: 'Propietario',
  manager: 'Manager',
  cashier: 'Cajero',
  stock: 'Depósito',
  viewer: 'Consulta',
  member: 'Miembro',
};

/**
 * Descripción honesta de lo que cada rol puede hacer hoy. Si cambia la matriz
 * de capacidades, esta descripción tiene que cambiar con ella.
 */
export const ROLE_DESCRIPTIONS: Record<TenantRole, string> = {
  owner: 'Control total: empresa, sucursales, colaboradores, facturación y plan.',
  manager:
    'Administra la operación y el equipo de sus sucursales. No puede asignar managers ni transferir la propiedad.',
  cashier:
    'Cobra ventas y opera la caja: abrir, cerrar y movimientos. No administra catálogo ni equipo.',
  stock:
    'Administra productos, precios, stock, compras y transferencias. No vende ni mueve la caja.',
  viewer:
    'Solo consulta: dashboard, ventas, productos y documentos, sin modificar nada.',
  member:
    'Registra ventas y consulta productos, clientes y documentos. No opera la caja ni administra el catálogo.',
};

/** Guía corta para el selector de rol. */
export const ROLE_OPTIONS = ASSIGNABLE_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
  description: ROLE_DESCRIPTIONS[role],
}));

/** Tooltip con todos los roles, para los ayudas de la UI. */
export const ROLE_HELP_TEXT = (ASSIGNABLE_ROLES as TenantRole[])
  .map((role) => `${ROLE_LABELS[role]}: ${ROLE_DESCRIPTIONS[role]}`)
  .join('\n');

export function isTenantRole(role: string | null | undefined): role is TenantRole {
  return typeof role === 'string' && role in ROLE_CAPABILITIES;
}

/** Capacidades de un rol. Un rol desconocido no tiene ninguna. */
export function getCapabilities(role: string | null | undefined): Capability[] {
  return isTenantRole(role) ? [...ROLE_CAPABILITIES[role]] : [];
}

/** ¿El rol tiene esta capacidad? Un rol nulo/desconocido nunca la tiene. */
export function hasCapability(
  role: string | null | undefined,
  capability: Capability
): boolean {
  return isTenantRole(role) && ROLE_CAPABILITIES[role].includes(capability);
}

export function getRoleLabel(role: string | null | undefined): string {
  return isTenantRole(role) ? ROLE_LABELS[role] : ROLE_LABELS.member;
}

/**
 * Ordena roles de mayor a menor alcance. Sirve para mostrar el rol "principal"
 * de alguien que tiene roles distintos en varias sucursales.
 */
const ROLE_RANK: Record<TenantRole, number> = {
  owner: 5,
  manager: 4,
  stock: 3,
  cashier: 3,
  viewer: 2,
  member: 1,
};

export function highestRole(roles: (string | null | undefined)[]): TenantRole {
  let best: TenantRole = 'member';
  let bestRank = -1;
  for (const role of roles) {
    if (!isTenantRole(role)) continue;
    const rank = ROLE_RANK[role];
    if (rank > bestRank) {
      best = role;
      bestRank = rank;
    }
  }
  return best;
}
