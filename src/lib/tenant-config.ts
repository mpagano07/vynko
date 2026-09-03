// Configuración por tenant para módulos y funcionalidades exclusivas.
//
// El plan Enterprise habilita módulos/adaptaciones a medida SIN tocar el
// código de otros usuarios: cada tenant lee su propia configuración desde
// la columna `tenants.settings` (JSONB). Los tenants Starter/Business no
// tienen estos flags, por lo que el comportamiento por defecto es idéntico
// al actual. Así evitamos dispersar `if plan === 'enterprise'` por el
// código y poder activar funcionalidades únicas por cliente de forma
// aislada.

export type TenantModuleFlags = {
  /**
   * Atajos de configuración de datos (JSONB) por tenant. La convención de
   * claves es `modules.<nombre>`.
   */
  modules?: Record<string, unknown>;
};

// Email de contacto para cotizaciones del plan Enterprise / ventas dedicadas.
export const SALES_EMAIL = 'ventas@vynko.dev';

/**
 * Lee los flags/módulos de un tenant a partir de su fila `settings` (JSONB).
 * Devuelve siempre un objeto seguro, sin importar el contenido del tenant.
 */
export function resolveTenantModules(
  settings: Record<string, unknown> | null | undefined
): TenantModuleFlags {
  const rawModules = settings?.modules as Record<string, unknown> | undefined;
  return {
    modules: typeof rawModules === 'object' && rawModules !== null ? rawModules : {},
  };
}

/**
 * Consulta si un tenant tiene un módulo/flag activo. El resto de tenants (o
 * settings sin esa key) devuelven `false` por defecto, preservando el
 * comportamiento actual para todos los usuarios.
 */
export function tenantHasModule(
  modules: TenantModuleFlags['modules'],
  moduleKey: string
): boolean {
  if (!modules) return false;
  return modules[moduleKey] === true;
}