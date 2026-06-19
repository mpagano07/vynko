import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerSupabaseClient } from '@/lib/supabase';

async function getAuth() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);
  if (!tu || tu.length === 0) return null;
  return { userId: user.id, tenantId: tu[0].tenant_id as string };
}

export async function GET(request: NextRequest) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 100);
  const offset = Number(searchParams.get('offset')) || 0;
  const unreadOnly = searchParams.get('unread_only') === 'true';
  const type = searchParams.get('type');

  let query = supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('tenant_id', auth.tenantId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .range(offset, offset + limit - 1);

  if (unreadOnly) query = query.eq('read', false);
  if (type) query = query.eq('type', type);

  const { data: notifications, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count: unreadCount, error: unreadError } = await supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', auth.tenantId)
    .eq('read', false);

  if (unreadError) return NextResponse.json({ error: unreadError.message }, { status: 500 });

  return NextResponse.json({ notifications, unreadCount, total: count });
}

export async function POST(request: Request) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { type, title, message, data: extraData } = body;

  if (!type || !title || !message) {
    return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('notifications')
    .insert({
      tenant_id: auth.tenantId,
      type,
      title,
      message,
      data: extraData || {},
      user_id: body.user_id || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
