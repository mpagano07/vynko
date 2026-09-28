import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { cancelSubscription } from '@/lib/billing-service';
import { isSameOriginRequest } from '@/lib/security/csrf';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const result = await cancelSubscription(user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}