import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { AuthInfo } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

export type ActivityLogsResult<T = unknown> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

export async function getActivityLogs(
  auth: AuthInfo,
  options: { limit?: string | null; offset?: string | null; entity_type?: string | null }
): Promise<ActivityLogsResult> {
  const tenantId = auth.tenantId;

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('role')
    .eq('user_id', auth.userId)
    .eq('tenant_id', tenantId);
  const role = tu?.[0]?.role;
  if (role !== 'owner' && role !== 'manager') {
    return { ok: false, error: 'No tienes permisos', status: 403 };
  }

  const limit = Math.min(Number(options.limit) || 50, 200);
  const offset = Number(options.offset) || 0;
  const entityType = options.entity_type;

  let query = supabaseAdmin
    .from('activity_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (auth.allTenants) query = query.in('tenant_id', auth.tenantIds);
  else query = query.eq('tenant_id', tenantId);

  if (entityType) query = query.eq('entity_type', entityType);

  const { data, error, count } = await query;
  if (error) {
    logger.error('DB error:', { error });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  return { ok: true, data: { data: data || [], total: count || 0 }, status: 200 };
}
