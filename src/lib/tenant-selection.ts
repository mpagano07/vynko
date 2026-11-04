/**
 * Elección de la sucursal activa inicial.
 *
 * Cuando el cliente todavía no mandó `x-active-tenant-id`, el servidor tiene
 * que elegir una. El orden de `tenant_users` no alcanza: alguien que es owner
 * de su propia empresa y además fue invitado como cajero a otra puede recibir
 * cualquiera de las dos como activa. La pertenencia como `owner` manda, así
 * arranca en la suya; si no tiene ninguna, se usa la primera membresía.
 *
 * Las consultas que lo alimentan piden `joined_at` ascendente, así que entre
 * varias empresas propias gana la más antigua.
 */
export interface TenantMembership {
  tenant_id: string;
  role?: string | null;
}

export function pickDefaultTenantId(
  memberships: TenantMembership[]
): string | null {
  if (memberships.length === 0) return null;
  const owned = memberships.find((member) => member.role === 'owner');
  return (owned ?? memberships[0]).tenant_id;
}
