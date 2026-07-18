import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);
  if (!tu || tu.length === 0) return NextResponse.json({ error: 'No tenant' }, { status: 401 });
  const tenantId = tu[0].tenant_id;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const { data: sales, error } = await supabaseAdmin
    .from('sales')
    .select('total_cents, status')
    .eq('tenant_id', tenantId)
    .gte('created_at', monthStart.toISOString())
    .eq('status', 'completed');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const totalCents = (sales ?? []).reduce((sum, s) => sum + ((s.total_cents as number) || 0), 0);
  const saleCount = (sales ?? []).length;

  return NextResponse.json({
    total: totalCents / 100,
    saleCount,
  });
}
