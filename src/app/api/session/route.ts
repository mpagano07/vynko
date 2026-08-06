import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ user: null, profile: null, tenant: null, tenants: [] });
    }

    const token = authHeader.replace('Bearer ', '');

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(
      token
    );

    if (userError || !userData?.user) {
      return NextResponse.json({ user: null, profile: null, tenant: null, tenants: [] });
    }

    const user = userData.user;

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    const { data: tenantUsers } = await supabaseAdmin
      .from('tenant_users')
      .select('tenant_id, role')
      .eq('user_id', user.id);

    const activeTenantId = request.headers.get('x-active-tenant-id');

    let tenants: Record<string, unknown>[] = [];
    let tenant = null;
    let role = null;

    if (tenantUsers && tenantUsers.length > 0) {
      const tenantIds = tenantUsers.map(tu => tu.tenant_id);

      const { data: tenantsData } = await supabaseAdmin
        .from('tenants')
        .select('*')
        .in('id', tenantIds);

      tenants = tenantsData || [];

      let targetId = tenantUsers[0].tenant_id;
      if (activeTenantId === '__all__') {
        // keep targetId as first tenant; no role change needed
      } else if (activeTenantId && tenantIds.includes(activeTenantId)) {
        targetId = activeTenantId;
      }

      const activeTU = tenantUsers.find(tu => tu.tenant_id === targetId);
      role = activeTU?.role || null;
      tenant = tenants.find(t => t.id === targetId) || tenants[0] || null;
    }

    return NextResponse.json({ user, profile, tenant, role, tenants });
  } catch (error) {
    console.error('Error in GET /api/session:', error);
    return NextResponse.json(
      { user: null, profile: null, tenant: null, tenants: [], error: 'Internal server error' },
      { status: 500 }
    );
  }
}
