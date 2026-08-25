import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { fixResponse } from '@/lib/utils/encoding';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const tenantId = auth.tenantId;

    const { data: tu } = await supabaseAdmin
      .from('tenant_users')
      .select('role')
      .eq('user_id', auth.userId)
      .eq('tenant_id', tenantId);
    const role = tu?.[0]?.role;
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
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (!auth.allTenants) query = query.eq('tenant_id', tenantId);

    if (entityType) query = query.eq('entity_type', entityType);

    const { data, error, count } = await query;
    if (error) { console.error('DB error:', error); return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 }); }

    return NextResponse.json(fixResponse({ data: data || [], total: count || 0 }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in activity logs';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
