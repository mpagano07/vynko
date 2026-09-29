import { createServerSupabaseClient } from '@/lib/supabase';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { safeInternalRedirect } from '@/lib/security/redirects';

export type ResetPasswordResult = {
  data: Record<string, unknown>;
  status: number;
  headers?: Record<string, string>;
};

/**
 * Pide el email de recuperacion.
 *
 * El cliente que se usa aca tiene que ser SIEMPRE el de servidor (`@supabase/ssr`),
 * nunca el de service role. Es la diferencia entre que el link funcione o no:
 *
 * - `@supabase/ssr` fija `flowType: 'pkce'` y guarda el `code-verifier` en una
 *   cookie (ver `createStorageFromOptions`). El link del email llega como
 *   `?code=...` y la cookie viaja al canjearlo.
 * - El cliente de service role usa el default de `supabase-js`, que es
 *   `flowType: 'implicit'`. Sin `code_challenge` no hay link PKCE: Supabase
 *   manda la sesion en el fragmento (`#access_token=...&type=recovery`), que el
 *   navegador no envia al servidor y la pagina de reset no sabe leer. El
 *   resultado era siempre "Link invalido o expirado".
 *
 * Poner `flowType: 'pkce'` en el cliente de service role tampoco lo arregla: el
 * verifier quedaria en el storage de ese proceso, que es de vida corta y distinto
 * del que despues canjea el `code`. La unica forma de que el verifier sobreviva
 * entre el pedido del email y el click es que viaje en una cookie.
 *
 * La sesion del service role sigue haciendo falta en otros lados, pero no aqui.
 */
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
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.toLowerCase(), {
    redirectTo,
  });

  if (error) {
    console.error('Error sending recovery email:', error);
  }

  return { data: { success: true, message: 'Email enviado' }, status: 200 };
}