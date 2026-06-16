import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

async function getAuthenticatedUser(request: Request) {
  const authHeader = request.headers.get('authorization');
  const refreshToken = request.headers.get('x-refresh-token');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const authClient = await createServerSupabaseClient();

    const { data: sessionData, error: sessionError } = await authClient.auth.setSession({
      access_token: token,
      refresh_token: refreshToken ?? '',
    });
    if (!sessionData?.session || sessionError) {
      return null;
    }

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) {
      return null;
    }

    return userData.user;
  }

  const authClient = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return null;
  }

  return user;
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ user: null, profile: null, tenant: null });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const { data: tenantUser, error: tenantUserError } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (tenantUserError) {
    return NextResponse.json({ error: tenantUserError.message }, { status: 500 });
  }

  let tenant = null;
  if (tenantUser?.tenant_id) {
    const { data: tenantData, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('id', tenantUser.tenant_id)
      .maybeSingle();

    if (tenantError) {
      return NextResponse.json({ error: tenantError.message }, { status: 500 });
    }

    tenant = tenantData;
  }

  return NextResponse.json({ user, profile, tenant });
}
