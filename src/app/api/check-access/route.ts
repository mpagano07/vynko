import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkSubscriptionBlocked } from '@/lib/checkSubscription';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'No token' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);

  if (!tu || tu.length === 0) {
    return NextResponse.json({ blocked: false });
  }

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('subscription_status, subscription_plan, created_at, subscription_current_period_end')
    .eq('id', tu[0].tenant_id)
    .single();

  const result = checkSubscriptionBlocked(tenant as any);

  return NextResponse.json(result);
}
