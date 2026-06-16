import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

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

export async function POST(request: Request) {
  const body = await request.json();
  const { companyName, ownerName } = body;

  if (!companyName || !ownerName) {
    return NextResponse.json({ error: 'companyName and ownerName are required' }, { status: 400 });
  }

  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'No authenticated user' }, { status: 401 });
  }

  const tenantId = crypto.randomUUID();
  const tenantSlug = `${slugify(companyName) || 'company'}-${crypto.randomUUID().slice(0, 8)}`;

  const { error: tenantError } = await supabaseAdmin
    .from('tenants')
    .insert(
      {
        id: tenantId,
        name: companyName,
        slug: tenantSlug,
      }
    );

  if (tenantError) {
    return NextResponse.json({ error: tenantError.message }, { status: 500 });
  }

  const { error: profileError } = await supabaseAdmin.from('profiles').upsert(
    {
      id: user.id,
      email: user.email,
      full_name: ownerName,
      tenant_id: tenantId,
    },
    {
      onConflict: 'id',
    }
  );

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const { error: tenantUserError } = await supabaseAdmin.from('tenant_users').upsert(
    {
      tenant_id: tenantId,
      user_id: user.id,
      role: 'owner',
    },
    {
      onConflict: 'tenant_id,user_id',
    }
  );

  if (tenantUserError) {
    return NextResponse.json({ error: tenantUserError.message }, { status: 500 });
  }

  return NextResponse.json({ tenantId });
}
