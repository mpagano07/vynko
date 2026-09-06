// Mapea errores de Supabase Auth (código o mensaje en inglés) a mensajes en
// español para no filtrar textos crudos del proveedor en la UI.
interface AuthErrorLike {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}

export function authErrorMessage(error: unknown): string {
  const e = (error && typeof error === 'object' ? error : {}) as AuthErrorLike;
  const code = e.code ?? null;
  const message = (e.message ?? '').toLowerCase();

  const matches = (...patterns: RegExp[]) => patterns.some((p) => p.test(message));

  if (code === 'email_not_confirmed' || matches(/email not confirmed/)) {
    return 'Aún no confirmás tu email. Revisá tu casilla y hacé clic en el link de verificación.';
  }
  if (code === 'invalid_credentials' || matches(/invalid login credentials|invalid credentials|invalid email|password does not match/i)) {
    return 'Email o contraseña incorrectos';
  }
  if (code === 'user_already_exists' || matches(/already (been )?registered|already exists/)) {
    return 'Este email ya está registrado. Usá "Olvidé mi contraseña" para acceder.';
  }
  if (code === 'email_address_invalid' || matches(/not a valid email|invalid email address/)) {
    return 'El email ingresado no es válido.';
  }
  if (code === 'weak_password' || matches(/password should be at least|password is too weak/)) {
    return 'La contraseña debe tener al menos 6 caracteres.';
  }
  if (code === 'same_password' || matches(/different from the old password/)) {
    return 'La nueva contraseña debe ser diferente a la anterior.';
  }
  if (code === 'over_email_send_rate_limit' || matches(/request this after|too many.*email|rate limit/i)) {
    return 'Se enviaron demasiados emails. Esperá un momento y volvé a intentar.';
  }
  if (code === 'user_banned' || matches(/banned|disabled/)) {
    return 'Tu cuenta fue suspendida. Escribinos a soporte@vynko.dev.';
  }
  if (code === 'otp_expired' || matches(/expired|otp/)) {
    return 'El código o link expiró. Probá iniciar sesión nuevamente.';
  }
  if (code === 'network_error' || matches(/failed to fetch|networkerror|network error|offline|load failed/)) {
    return 'Error de conexión. Verificá tu internet y probá de nuevo.';
  }
  if (code === 'popup_closed_by_user' || matches(/popup closed|closed by user|cancelled by user/)) {
    return 'Cancelaste el inicio de sesión con Google. Probá de nuevo.';
  }

  return (e.message && e.message.trim()) ? e.message : 'Ocurrió un error inesperado. Intentalo de nuevo.';
}