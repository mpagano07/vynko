export const GOOGLE_DRIVE_STATE_COOKIE = 'gdrive_oauth_state';

/**
 * `drive.file` es un scope NO sensible: da acceso sólo a los archivos que el
 * usuario elige con Google Picker. No agregar `drive.readonly` ni `drive`:
 * son restringidos y obligan a verificación OAuth + evaluación CASA.
 *
 * Tampoco hace falta `openid`, `email` ni `profile`: la identidad ya la
 * resuelve Supabase y este flujo sólo necesita el token de Drive. Pedirlos
 * agrega permisos en la pantalla de consentimiento sin usarlos.
 */
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export function hasDriveFileScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).includes(GOOGLE_DRIVE_SCOPE);
}
