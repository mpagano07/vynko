import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { AuthInfo } from '@/lib/api-auth';
import { hasCapability } from '@/lib/roles';
import { logger } from '@/lib/logger';

export type ActivityLogsResult<T = unknown> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

export async function getActivityLogs(
  auth: AuthInfo,
  options: { limit?: string | null; offset?: string | null; entity_type?: string | null; q?: string | null }
): Promise<ActivityLogsResult> {
  const tenantId = auth.tenantId;

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('role')
    .eq('user_id', auth.userId)
    .eq('tenant_id', tenantId);
  const role = tu?.[0]?.role;
  if (!hasCapability(role, 'view_reports')) {
    return { ok: false, error: 'No tienes permisos', status: 403 };
  }

  const limit = Math.min(Number(options.limit) || 50, 200);
  const offset = Number(options.offset) || 0;
  const entityType = options.entity_type;
  // Búsqueda libre por usuario, producto, SKU o folio. Se limpian los
  // separadores de PostgREST para no romper el filtro `or`.
  const q = (options.q ?? '').trim().replace(/[%,()*"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

  let query = supabaseAdmin
    .from('activity_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (auth.allTenants) query = query.in('tenant_id', auth.tenantIds);
  else query = query.eq('tenant_id', tenantId);

  if (entityType) query = query.eq('entity_type', entityType);
  if (q) {
    query = query.or(
      [
        `user_name.ilike.%${q}%`,
        `details->>name.ilike.%${q}%`,
        `details->>folio.ilike.%${q}%`,
        `details->>sku.ilike.%${q}%`,
      ].join(',')
    );
  }

  const { data, error, count } = await query;
  if (error) {
    logger.error('DB error:', { error });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  return { ok: true, data: { data: data || [], total: count || 0 }, status: 200 };
}
