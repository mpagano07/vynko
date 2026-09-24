import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isAdminEmail } from '@/lib/admin';
import { getAdminAnalytics } from '@/lib/analytics-service';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await getAdminAnalytics();
  return NextResponse.json(result.data);
}