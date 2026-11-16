/**
 * Rutas que trabajan sobre una sucursal concreta (ventas, caja, documentos,
 * pronóstico, antipérdidas, QR y escáner). En "Todas las sucursales" no hay un
 * `tenant_id` contra el cual operar, así que en vez de dejar la página cargando
 * para siempre se muestra una pantalla que pide elegir una sucursal.
 *
 * El sidebar usa la misma lista (`requiredSingleBranch`) para mostrar estas
 * secciones con candado en el modo consolidado.
 */
export const SINGLE_BRANCH_ROUTES = [
  '/sales',
  '/documents',
  '/invoices',
  '/forecast',
  '/loss-prevention',
  '/qr-codes',
  '/scanning',
] as const;

/**
 * `true` si la ruta necesita una sucursal activa. Compara por segmento para que
 * `/sales/cash-register` cuente como `/sales` sin que `/salesx` matchee.
 */
export function requiresSingleBranch(pathname: string): boolean {
  return SINGLE_BRANCH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}
