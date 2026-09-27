import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { safeInternalRedirect } from '@/lib/security/redirects';

export type ResetPasswordResult = {
  data: Record<string, unknown>;
  status: number;
  headers?: Record<string, string>;
};

export async function sendResetPasswordEmail(request: Request): Promise<ResetPasswordResult> {
  const { email } = await request.json();

  if (!email || typeof email !== 'string') {
    return { data: { error: 'Email requerido' }, status: 400 };
  }

  const ipLimit = await rateLimit(`fp:ip:${getClientIp(request)}`, 10, 15 * 60 * 1000);
  if (!ipLimit.ok) {
    return {
      data: { error: 'Demasiados intentos. Probá de nuevo más tarde.' },
      status: 429,
      headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) },
    };
  }
  const emailLimit = await rateLimit(`fp:email:${email.toLowerCase()}`, 3, 15 * 60 * 1000);
  if (!emailLimit.ok) {
    return {
      data: { success: true, message: 'Email enviado' },
      status: 200,
      headers: { 'Retry-After': String(emailLimit.retryAfterSeconds) },
    };
  }

  const redirectTo = safeInternalRedirect(request, '/auth/reset-password');
  const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email.toLowerCase(), {
    redirectTo,
  });

  if (error) {
    console.error('Error sending recovery email:', error);
  }

  return { data: { success: true, message: 'Email enviado' }, status: 200 };
}