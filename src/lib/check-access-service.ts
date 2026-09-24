import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  checkSubscriptionBlocked,
  consolidateOwnerSubscription,
  type TenantSubscription,
} from '@/lib/checkSubscription';

export type CheckAccessResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; status: number };

export async function checkAccess(request: Request): Promise<CheckAccessResult> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, error: 'No token', status: 401 };
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) {
    return { ok: false, error: 'Invalid token', status: 401 };
  }

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);

  if (!tu || tu.length === 0) {
    return { ok: true, data: { blocked: false } };
  }

  const tenantIds = tu.map((t) => t.tenant_id);
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('subscription_status, subscription_plan, created_at, subscription_current_period_end')
    .in('id', tenantIds);

  const consolidated = consolidateOwnerSubscription(tenants as TenantSubscription[] | null);
  const result = consolidated ? checkSubscriptionBlocked(consolidated) : { blocked: false };

  return { ok: true, data: result };
}