import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { generateResetToken, hashResetToken } from '@/lib/reset-token';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email requerido' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const ipLimit = rateLimit(`fp:ip:${ip}`, 10, 15 * 60 * 1000);
    if (!ipLimit.ok) {
      return NextResponse.json(
        { error: 'Demasiados intentos. Probá de nuevo más tarde.' },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) } }
      );
    }
    const emailLimit = rateLimit(`fp:email:${email.toLowerCase()}`, 3, 15 * 60 * 1000);
    if (!emailLimit.ok) {
      return NextResponse.json(
        { success: true, message: 'Email enviado' },
        { headers: { 'Retry-After': String(emailLimit.retryAfterSeconds) } }
      );
    }

    const normalizedEmail = email.toLowerCase();
    const token = generateResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await supabaseAdmin
      .from('password_reset_tokens')
      .delete()
      .eq('email', normalizedEmail);

    const { error: tokenError } = await supabaseAdmin
      .from('password_reset_tokens')
      .insert({
        email: normalizedEmail,
        token_hash: hashResetToken(token),
        expires_at: expiresAt,
      });

    if (tokenError) {
      console.error('Error saving reset token:', tokenError);
      return NextResponse.json({ error: 'Error al procesar la solicitud' }, { status: 500 });
    }

    await supabaseAdmin
      .from('password_reset_tokens')
      .delete()
      .lt('expires_at', new Date().toISOString());

    const origin = new URL(request.url).origin;
    const resetLink = `${origin}/auth/reset-password?token=${token}`;

    // Generate recovery link using Supabase Admin Auth
    const { error: emailError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: normalizedEmail,
      options: { redirectTo: resetLink }
    });

    if (emailError) {
      console.error('Error generating recovery link:', emailError);
      return NextResponse.json({ success: true, message: 'Email enviado' });
    }

    return NextResponse.json({ success: true, message: 'Email enviado' });
  } catch (err) {
    console.error('Error in POST /api/auth/forgot-password:', err);
    return NextResponse.json({ success: true, message: 'Email enviado' });
  }
}
