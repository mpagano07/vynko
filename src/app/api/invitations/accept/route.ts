import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !user.email) {
      return NextResponse.json({ accepted: 0 });
    }

    const { data: invitations } = await supabaseAdmin
      .from('invitations')
      .select('id, tenant_id, role')
      .eq('email', user.email.toLowerCase())
      .is('accepted_at', null);

    if (!invitations || invitations.length === 0) {
      return NextResponse.json({ accepted: 0 });
    }

    let accepted = 0;
    for (const inv of invitations) {
      const { error: upsertError } = await supabaseAdmin.from('profiles').upsert(
        { id: user.id, email: user.email, tenant_id: inv.tenant_id },
        { onConflict: 'id' }
      );
      if (upsertError) continue;

      const { error: tuError } = await supabaseAdmin.from('tenant_users').upsert(
        { tenant_id: inv.tenant_id, user_id: user.id, role: inv.role },
        { onConflict: 'tenant_id,user_id' }
      );
      if (tuError) continue;

      await supabaseAdmin
        .from('invitations')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', inv.id);

      accepted++;
    }

    return NextResponse.json({ accepted });
  } catch (err) {
    console.error('Error accepting invitations:', err);
    return NextResponse.json({ accepted: 0 }, { status: 500 });
  }
}
