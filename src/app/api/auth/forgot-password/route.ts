import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email requerido' }, { status: 400 });
    }

    const ipLimit = rateLimit(`fp:ip:${getClientIp(request)}`, 10, 15 * 60 * 1000);
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

    const origin = new URL(request.url).origin;
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email.toLowerCase(), {
      redirectTo: `${origin}/auth/reset-password`,
    });

    if (error) {
      console.error('Error sending recovery email:', error);
      return NextResponse.json({ success: true, message: 'Email enviado' });
    }

    return NextResponse.json({ success: true, message: 'Email enviado' });
  } catch (err) {
    console.error('Error in POST /api/auth/forgot-password:', err);
    return NextResponse.json({ success: true, message: 'Email enviado' });
  }
}
