import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email requerido' }, { status: 400 });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await supabaseAdmin
      .from('password_reset_tokens')
      .delete()
      .eq('email', email.toLowerCase());

    const { error: tokenError } = await supabaseAdmin
      .from('password_reset_tokens')
      .insert({
        email: email.toLowerCase(),
        token,
        expires_at: expiresAt,
      });

    if (tokenError) {
      console.error('Error saving reset token:', tokenError);
      return NextResponse.json({ error: 'Error al procesar la solicitud' }, { status: 500 });
    }

    const origin = new URL(request.url).origin;
    const resetLink = `${origin}/auth/reset-password?token=${token}`;

    // Generate recovery link using Supabase Admin Auth
    const { error: emailError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email.toLowerCase(),
      options: { redirectTo: resetLink }
    });

    if (emailError) {
      console.error('Error generating recovery link:', emailError);
      return NextResponse.json({ error: 'Error al procesar la solicitud' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Email enviado' });
  } catch (err) {
    console.error('Error in POST /api/auth/forgot-password:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
