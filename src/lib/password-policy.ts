/**
 * Politica de contrasenas, en un solo lugar.
 *
 * Antes cada flujo repetia su propio `length < 6` en el cliente y el servidor, y
 * no todos coincidian. Eso dejaba huecos: el navegador validaba una cosa, la
 * ruta otra, y la regla real la terminaba poniendo Supabase. Ahora hay una
 * funcion que decide y se usa en los cuatro caminos que escriben una contrasena
 * (alta, recuperacion, cambio e invitacion), en el servidor y en el cliente.
 *
 * Que la aplique el servidor es lo que importa: la validacion del navegador es
 * solo una ayuda para dar feedback inmediato y se puede saltear con un POST a
 * pelo.
 *
 * La parte autoritativa sigue siendo la configuracion de Supabase
 * (Authentication -> Password -> Minimum password length / strength). Esta
 * funcion no la reemplaza: la adelanta para poder dar un mensaje util en
 * espanol. Si Supabase exige mas que esto, el error se traduce igual y el
 * rechazo llega igual.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

export type PasswordValidation = { ok: true } | { ok: false; error: string };

/** Parte del email antes de la arroba, en minúsculas. */
function emailLocalPart(email?: string | null): string {
  if (!email) return '';
  return email.trim().toLowerCase().split('@')[0] ?? '';
}

/**
 * Todo un mismo caracter repetido ("aaaaaaaa", "11111111") pasa cualquier
 * chequeo de largo y es de los primeros que aparecen en un diccionario.
 */
function isSingleRepeatedCharacter(password: string): boolean {
  return /^(\S)\1+$/.test(password);
}

export function validatePassword(
  password: unknown,
  options: { email?: string | null } = {}
): PasswordValidation {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, error: 'La contraseña es obligatoria' };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`,
    };
  }

  // El limite superior existe porque el hasheo de Supabase corta o rechaza
  // entradas muy largas, y sin tope un POST de un megabyte llega igual al
  // backend.
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: 'La contraseña es demasiado larga' };
  }

  const normalized = password.trim().toLowerCase();

  if (isSingleRepeatedCharacter(normalized)) {
    return { ok: false, error: 'La contraseña no puede ser un mismo carácter repetido' };
  }

  const email = options.email?.trim().toLowerCase() ?? '';
  if (email && normalized === email) {
    return { ok: false, error: 'La contraseña no puede ser tu email' };
  }

  const local = emailLocalPart(options.email);
  // Solo se compara contra la parte del email cuando es lo bastante larga para
  // que la coincidencia signifique algo: con un local de 2 letras, "ab" esta
  // dentro de casi cualquier contrasena y el rechazo seria ruido.
  if (local.length >= 4 && normalized === local) {
    return { ok: false, error: 'La contraseña no puede ser tu email' };
  }

  return { ok: true };
}
