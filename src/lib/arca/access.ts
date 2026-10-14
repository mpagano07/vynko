import { isAdminProfile, type AdminCapableProfile } from '@/lib/admin';

/**
 * Planes que van a habilitar la facturación electrónica cuando se lance del
 * todo. Hoy todavía no se usa: durante las pruebas la feature es sólo para la
 * cuenta admin.
 */
export const FACTURACION_PLANS: readonly string[] = ['business', 'enterprise'];

/**
 * Interruptor de lanzamiento.
 *
 * `false` = facturación ARCA en pruebas internas: sólo la cuenta admin.
 * `true`  = además de admin, se habilita a las empresas en `FACTURACION_PLANS`.
 */
export const FACTURACION_LAUNCHED: boolean = false;

export interface FacturacionTenant {
  subscription_plan?: string | null;
}

/**
 * ¿La cuenta puede usar la facturación electrónica ARCA?
 *
 * Es el predicado compartido por la UI y el servidor. Durante las pruebas sólo
 * la cuenta admin; al lanzar, también los planes de `FACTURACION_PLANS`.
 */
export function canUseFacturacion(
  profile: AdminCapableProfile | null | undefined,
  tenant?: FacturacionTenant | null
): boolean {
  if (isAdminProfile(profile)) return true;
  if (!FACTURACION_LAUNCHED) return false;
  return FACTURACION_PLANS.includes(tenant?.subscription_plan ?? '');
}
