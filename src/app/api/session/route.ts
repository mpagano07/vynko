import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ user: null, profile: null, tenant: null });
  }

  const token = authHeader.replace('Bearer ', '');

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(
    token
  );

  if (userError || !userData?.user) {
    return NextResponse.json({ user: null, profile: null, tenant: null });
  }

  const user = userData.user;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  const { data: tenantUser } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id)
    .maybeSingle();

  let tenant = null;
  if (tenantUser?.tenant_id) {
    const { data: tenantData } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('id', tenantUser.tenant_id)
      .maybeSingle();

    tenant = tenantData;
  }

  return NextResponse.json({ user, profile, tenant });
}
