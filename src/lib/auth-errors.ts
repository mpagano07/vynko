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

interface ClassifiedAuthError {
  status: number;
  message: string;
  retryAfterSeconds?: number;
}

/**
 * Traduce un fallo de GoTrue a una respuesta HTTP con sentido.
 *
 * La necesidad aparece por el rate limit de email del propio Supabase: si el
 * proyecto manda demasiados correos, `signUp` devuelve 429 con
 * `over_email_send_rate_limit`. La ruta lo traducía a un 400 "No se pudo crear
 * la cuenta", que es peor que inútil: el status dice "tu request está mal"
 * cuando en realidad hay que esperar, el mensaje no dice qué hacer, y sin
 * `Retry-After` el cliente no tiene forma de saber si reintentar. Peor aún,
 * un 400 por cuota agotada es indistinguible de un 400 por contraseña inválida,
 * así que un signup que funciona se ve exactamente igual que uno roto.
 *
 * Solo se traduce lo que NO depende de si el email existe (cuota y capacidad),
 * porque todo lo demás tiene que seguir contestando igual para un alta nueva y
 * para un email ya registrado. Cualquier código desconocido cae en el mensaje
 * genérico que le pasa el llamador: no se filtra el texto crudo del proveedor
 * ni se confirma la existencia de una cuenta.
 */
export function classifyAuthFailure(
  error: unknown,
  fallbackMessage: string
): ClassifiedAuthError {
  const e = (error && typeof error === 'object' ? error : {}) as AuthErrorLike;
  const code = e.code ?? null;
  const message = (e.message ?? '').toLowerCase();
  const status = e.status ?? null;

  // Cuota de envío de correo agotada. Es la causa más común en dev: el SMTP
  // incluido en Supabase tiene un tope muy bajo y todos los intentos de alta lo
  // tocan enseguida. No dice nada sobre el email, se dispara igual para uno
  // nuevo que para uno repetido.
  if (code === 'over_email_send_rate_limit' || /request this after|too many.*email/.test(message)) {
    return {
      status: 429,
      message: 'Se enviaron demasiados emails de confirmación. Esperá unos minutos y volvé a intentar.',
      // Es una sugerencia para el cliente, no el reinicio real de la cuota: el
      // backend de Supabase no lo expone. Sirve para que un reintento automático
      // respete un piso en vez de martillar la API.
      retryAfterSeconds: 60,
    };
  }

  // Alta por encima del tope de peticiones por hora del proyecto.
  if (code === 'over_request_rate_limit') {
    return {
      status: 429,
      message: 'Demasiados registros desde esta conexión. Probá más tarde.',
      retryAfterSeconds: 60,
    };
  }

  // Auth sin capacidad para servir el pedido: transitorio, no es culpa del
  // usuario, así que no se devuelve 400.
  if (code === 'over_capacity' || status === 503) {
    return {
      status: 503,
      message: 'El servicio de registro está momentáneamente saturado. Probá en unos minutos.',
      retryAfterSeconds: 60,
    };
  }

  // Cualquier otro 429 que llegue de abajo.
  if (status === 429) {
    return {
      status: 429,
      message: 'Demasiados intentos. Esperá unos minutos y volvé a intentar.',
      retryAfterSeconds: 60,
    };
  }

  return { status: 400, message: fallbackMessage };
}