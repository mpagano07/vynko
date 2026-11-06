/**
 * Constantes y tipos del kill switch, sin dependencias de servidor.
 *
 * Vive separado de `kill-switch.ts` para que los componentes de cliente
 * (`/admin/ops`, el banner) puedan importar las claves y las etiquetas sin
 * arrastrar `next/server` ni el cliente de Supabase al bundle del navegador.
 */

export const KILL_AREAS = ['sales', 'payments', 'forecast', 'imports'] as const;
export type KillArea = (typeof KILL_AREAS)[number];

export interface KillSwitchState {
  sales: boolean;
  payments: boolean;
  forecast: boolean;
  imports: boolean;
  maintenance: boolean;
}

/** Solo las claves forzadas a ON por env; el resto lo decide la base. */
export type KillSwitchEnvOverrides = Partial<Record<keyof KillSwitchState, boolean>>;

/** Clave de `feature_flags` por area. */
export const KILL_SWITCH_FLAG_KEYS: Record<keyof KillSwitchState, string> = {
  sales: 'kill_sales',
  payments: 'kill_payments',
  forecast: 'kill_forecast',
  imports: 'kill_imports',
  maintenance: 'maintenance_mode',
};

/** Variable de entorno que puede forzar cada area. */
export const KILL_SWITCH_ENV_NAMES: Record<keyof KillSwitchState, string> = {
  sales: 'FEATURE_KILL_SALES',
  payments: 'FEATURE_KILL_PAYMENTS',
  forecast: 'FEATURE_KILL_FORECAST',
  imports: 'FEATURE_KILL_IMPORTS',
  maintenance: 'MAINTENANCE_MODE',
};

export const KILL_SWITCH_LABELS: Record<keyof KillSwitchState, string> = {
  sales: 'Ventas',
  payments: 'Pagos (Paddle)',
  forecast: 'Pronóstico',
  imports: 'Importación de productos',
  maintenance: 'Mantenimiento global',
};

export const KILL_SWITCH_DESCRIPTIONS: Record<keyof KillSwitchState, string> = {
  sales: 'Bloquea POST /api/sales: no se pueden registrar ventas nuevas.',
  payments: 'Bloquea checkout, portal y downgrade de Paddle. No bloquea los webhooks.',
  forecast: 'Bloquea GET /api/forecast.',
  imports: 'Bloquea POST /api/products/import.',
  maintenance: 'Manda las páginas de la app a /maintenance y bloquea las cuatro áreas.',
};
