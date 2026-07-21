import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    let userId: string | null = null;
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const { data: userData } = await supabaseAdmin.auth.getUser(token);
      userId = userData?.user?.id || null;
    }
    if (!userId) {
      const supabase = await createServerSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id || null;
    }
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: tu } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id, role')
      .eq('user_id', userId);
    if (!tu || tu.length === 0) return NextResponse.json({ error: 'No tenant' }, { status: 401 });
    const { tenant_id: tenantId, role } = tu[0];
    if (role !== 'owner' && role !== 'manager') {
      return NextResponse.json({ error: 'No tienes permisos' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);
    const offset = Number(searchParams.get('offset')) || 0;
    const entityType = searchParams.get('entity_type');

    let query = supabaseAdmin
      .from('activity_logs')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (entityType) query = query.eq('entity_type', entityType);

    const { data, error, count } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data: data || [], total: count || 0 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in activity logs';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
