import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { AuthInfo } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

export type AccountResult<T = unknown> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

/**
 * Tablas de negocio con `tenant_id` que se incluyen en la exportacion de datos
 * del titular (art. 14 Ley 25.326: acceso/portabilidad; RGPD art. 20). La lista
 * es explicita a proposito: un `select('*')` sobre `information_schema` traeria
 * tablas internas (idempotencia, rate limits, eventos) que no son datos del
 * usuario y solo enturbiarian el archivo que se lleva.
 */
const EXPORT_TABLES = [
  'products',
  'product_stock',
  'categories',
  'suppliers',
  'providers',
  'customers',
  'sales',
  'sale_items',
  'sale_payments',
  'cash_register_sessions',
  'cash_movements',
  'commercial_documents',
  'commercial_document_items',
  'purchase_orders',
  'purchase_order_items',
  'stock_movements',
  'stock_history',
  'stock_transfers',
  'stock_transfer_items',
  'activity_logs',
] as const;

/**
 * Tenants donde el usuario es owner. La exportacion y el borrado de cuenta se
 * limitan a esas empresas: en una donde solo es 'member', los datos de negocio
 * son de otra persona, no suyos, y no puede ni exportarlos ni borrarlos.
 */
async function getOwnedTenantIds(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', userId);
  return (data ?? [])
    .filter((r) => r.role === 'owner')
    .map((r) => r.tenant_id as string);
}

/**
 * Arma el paquete de datos del titular: su perfil, las empresas que administra
 * y los registros de negocio de cada una. Devuelve JSON serializable, pensado
 * para descargarse como archivo.
 */
export async function exportAccountData(
  auth: AuthInfo
): Promise<AccountResult<Record<string, unknown>>> {
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, avatar_url, created_at, updated_at')
      .eq('id', auth.userId)
      .maybeSingle();

    const { data: memberships } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id, role')
      .eq('user_id', auth.userId);

    const ownedTenantIds = (memberships ?? [])
      .filter((m) => m.role === 'owner')
      .map((m) => m.tenant_id as string);

    let tenants: Record<string, unknown>[] = [];
    const businessData: Record<string, unknown[]> = {};

    if (ownedTenantIds.length > 0) {
      const { data: tenantRows } = await supabaseAdmin
        .from('tenants')
        .select('id, name, slug, description')
        .in('id', ownedTenantIds);
      tenants = tenantRows ?? [];

      for (const table of EXPORT_TABLES) {
        const { data, error } = await supabaseAdmin
          .from(table)
          .select('*')
          .in('tenant_id', ownedTenantIds);
        if (error) {
          logger.error('Export: fallo al leer tabla', { table, error });
          continue;
        }
        businessData[table] = data ?? [];
      }
    }

    return {
      ok: true,
      status: 200,
      data: {
        exported_at: new Date().toISOString(),
        account: {
          profile: profile ?? null,
          memberships: memberships ?? [],
        },
        tenants,
        data: businessData,
      },
    };
  } catch (err) {
    logger.error('Error exporting account data:', { error: err });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }
}

/**
 * Borra la cuenta del titular y los datos que le pertenecen.
 *
 * Reglas:
 *  - Solo el owner borra SUS empresas (y con ellas, por ON DELETE CASCADE, todo
 *    el inventario, ventas y documentos de esas empresas).
 *  - Si el usuario es 'member' en la empresa de otro, NO se toca esa empresa:
 *    solo se remueve su membresia. Sus datos de negocio son de otro titular.
 *  - Requiere confirmacion explicita (`confirm: 'ELIMINAR'`) para no dejar un
 *    borrado irreversible detras de un solo clic.
 *  - Al final se borra el `auth.user`, que cascada a `profiles` y a cualquier
 *    `tenant_users`/`invitations` remanentes.
 */
export async function deleteAccount(
  auth: AuthInfo,
  body: { confirm?: unknown }
): Promise<AccountResult<{ deleted: true }>> {
  try {
    if (body.confirm !== 'ELIMINAR') {
      return {
        ok: false,
        error: 'Confirmación inválida. Escribí ELIMINAR para borrar la cuenta.',
        status: 400,
      };
    }

    const ownedTenantIds = await getOwnedTenantIds(auth.userId);

    if (ownedTenantIds.length > 0) {
      const { error: tenantError } = await supabaseAdmin
        .from('tenants')
        .delete()
        .in('id', ownedTenantIds);
      if (tenantError) {
        logger.error('DB error deleting owned tenants:', { error: tenantError });
        return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
      }
    }

    // Membresias sobrantes (empresas de terceros donde solo era member). El
    // borrado del auth.user tambien las cascadearia, pero hacerlo explicito deja
    // el estado consistente aunque el borrado del usuario falle despues.
    const { error: membershipError } = await supabaseAdmin
      .from('tenant_users')
      .delete()
      .eq('user_id', auth.userId);
    if (membershipError) {
      logger.error('DB error deleting memberships:', { error: membershipError });
    }

    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(auth.userId);
    if (authError) {
      logger.error('Error deleting auth user:', { error: authError });
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
    }

    return { ok: true, status: 200, data: { deleted: true } };
  } catch (err) {
    logger.error('Error deleting account:', { error: err });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }
}
