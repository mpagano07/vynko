import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { enterLogContext, resolveRequestId } from '@/lib/log-context';
import { pickDefaultTenantId } from '@/lib/tenant-selection';
import { logger } from '@/lib/logger';
import { isTenantRole, type TenantRole } from '@/lib/roles';

function requestPath(request?: Request): string | null {
  if (!request) return null;
  try {
    return new URL(request.url).pathname;
  } catch {
    return null;
  }
}

export interface AuthInfo {
  tenantId: string;
  userId: string;
  allTenants: boolean;
  tenantIds: string[];
  /**
   * Rol del usuario en la sucursal activa (`tenantId`). Lo completa `getAuth`
   * a partir de las membresías que ya consulta, así que los gates pueden
   * decidir sin una query extra por request. En el consolidado (`allTenants`)
   * es `owner`, que es la única forma de llegar a ese modo.
   *
   * Es opcional para no romper objetos `AuthInfo` construidos a mano en tests
   * o scripts; ausente equivale a "sin permisos".
   *
   * El tipo es `TenantRole | null` y no `string | null`: el valor viene de la
   * base y un rol escrito a mano (o una fila corrupta) no debe colarse como una
   * cadena arbitraria en los gates de capacidades. `getAuth` lo valida con
   * `isTenantRole` y lo normaliza a `null` si no es un rol conocido.
   */
  role?: TenantRole | null;
}

export async function getAuth(request?: Request): Promise<AuthInfo | null> {
  // Contexto de log de este request. Se entra aca porque es el punto por el que
  // pasa casi toda ruta autenticada: lo que se loguee despues (servicios, RPCs,
  // `after()`) hereda `requestId`, `userId` y `tenantId` sin pasarselos a mano.
  enterLogContext({ requestId: resolveRequestId(request) });

  // Las mutaciones se rechazan si el navegador las envía desde otro origen
  // (CSRF). Las cookies de sesión son SameSite=Lax, así que el POST
  // cross-site ya viaja sin credenciales; esto es la segunda barrera.
  if (request && !isSameOriginRequest(request)) {
    logger.warn('getAuth: request rechazada por origen', {
      path: requestPath(request),
      method: request.method,
      origin: request.headers.get('origin'),
      fetchSite: request.headers.get('sec-fetch-site'),
    });
    return null;
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // Un 401 sin esta pista es indistinguible de una sesion vencida, una cookie
    // perdida o un proyecto de Supabase distinto. El path permite encontrar el
    // endpoint exacto en los logs.
    logger.warn('getAuth: request sin sesión válida', { path: requestPath(request) });
    return null;
  }

  // Sólo las membresías activas dan acceso: una persona desactivada conserva
  // su fila (y su historial), pero deja de resolver tenant y rol. Es lo que
  // hace que "desactivar" sea distinto de "eliminar" sin abrir una puerta.
  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('joined_at', { ascending: true });

  if (!tu || tu.length === 0) {
    logger.warn('getAuth: usuario sin membresías activas', {
      path: requestPath(request),
      userId: user.id,
    });
    return null;
  }

  const allTenantIds = (tu ?? []).map((t) => t.tenant_id);
  let tenantIds = allTenantIds;
  let tenantId = pickDefaultTenantId(tu ?? []) ?? allTenantIds[0];
  let allTenants = false;

  const activeTenantId = request?.headers.get('x-active-tenant-id');
  if (activeTenantId === '__all__') {
    // El consolidado queda restringido a los tenants donde el usuario es owner
    // (no a todos sus tenants de pertenencia).
    const ownerTenants = (tu ?? []).filter((t) => t.role === 'owner').map((t) => t.tenant_id);
    if (ownerTenants.length > 0) {
      allTenants = true;
      tenantId = ownerTenants[0];
      tenantIds = ownerTenants;
    }
  } else if (activeTenantId && tenantIds.includes(activeTenantId)) {
    tenantId = activeTenantId;
  }

  enterLogContext({ userId: user.id, tenantId, tenantIds });
  const rawRole = (tu ?? []).find((t) => t.tenant_id === tenantId)?.role ?? null;
  // Solo roles conocidos llegan a `AuthInfo`. Un valor inesperado en la base se
  // trata como "sin permisos" en vez de viajar como string sin validar.
  const role: TenantRole | null = isTenantRole(rawRole) ? rawRole : null;
  return { tenantId, userId: user.id, role, allTenants, tenantIds };
}
