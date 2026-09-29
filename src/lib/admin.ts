/**
 * Fuente de verdad del flag de admin: la columna `profiles.is_admin`.
 *
 * Antes el admin era un email literal en el codigo (`ADMIN_EMAIL`), repetido aca
 * y en la funcion SQL `is_admin()` de la migration 034. Eso obligaba a tocar y
 * desplegar codigo para cambiar quien es admin, y dejaba un email personal
 * en el historial de git.
 *
 * Importante: la visibilidad de la seccion Admin del sidebar y el guard de la
 * pagina de analytics son UX, NO autorizacion. La decision que vale es la que
 * toma el servidor: la policy de `analytics_events` (RLS) y
 * `GET /api/admin/analytics`, que resuelven el flag con service_role. Ocultar un
 * link no protege nada.
 */
export interface AdminCapableProfile {
  is_admin?: boolean | null;
}

/**
 * `true` solo ante un booleano `true` explicito.
 *
 * Deliberadamente no es truthy: durante el rollout, o en un entorno donde la
 * migration 038 todavia no esta aplicada, el valor llega `undefined` (la
 * columna no existe) y un chequeo truthy dejaria pasar a cualquiera que tenga
 * cualquier otro campo truthy. Ante la duda, negar acceso.
 */
export function isAdminProfile(profile: AdminCapableProfile | null | undefined): boolean {
  return profile?.is_admin === true;
}
