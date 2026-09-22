import prices from './prices.json';

export type PlanFeature = {
  label: string;
  value?: string;
  included: boolean;
};

export type PlanId = 'starter' | 'business' | 'enterprise';

export const PLAN_ORDER: PlanId[] = ['starter', 'business', 'enterprise'];

export const PLAN_LIMITS: Record<PlanId, { products: number; users: number; branches: number }> = {
  starter: { products: 50, users: 1, branches: 1 },
  business: { products: Infinity, users: Infinity, branches: 5 },
  enterprise: { products: Infinity, users: Infinity, branches: 99 },
};

export type Plan = {
  id: string;
  name: string;
  price: number;
  comingSoon?: boolean;
  features: PlanFeature[];
};

/**
 * Promos activas por plan. Una sola promoción por plan.
 *
 * - `trial`: el plan se ofrece gratis los primeros `days` días desde la
 *   creación de la cuenta (período de prueba).
 * - `free`: el plan está gratis por tiempo limitado (hasta `until`).
 * - `discount`: porcentaje de descuento hasta `until` (precio efectivo
 *   se calcula en `getEffectivePrice`).
 *
 * `until` (ISO date) es la fecha límite de la oferta y alimenta el countdown
 * de la landing. Si no se define, `getPromoDeadline` usa el fin del mes en
 * curso como urgencia por defecto.
 *
 * Para cambiar el plan en prueba, el descuento o un período gratis, solo
 * hay que editar este objeto: toda la app (trial gate, checkouts, badges,
 * CTA de la landing) se ajusta sola.
 */
export type PlanPromo =
  | { type: 'trial'; days: number; badge: string; until?: string }
  | { type: 'free'; until?: string; badge: string }
  | { type: 'discount'; percent: number; until?: string; badge: string };

export const PROMOS: Partial<Record<PlanId, PlanPromo>> = {
  business: { type: 'trial', days: 45, badge: '45 días gratis' },
};

export const getPromo = (planId: PlanId | string | undefined | null): PlanPromo | undefined =>
  planId ? PROMOS[planId as PlanId] : undefined;

export const getTrialPlan = (): PlanId | null => {
  for (const id of PLAN_ORDER) {
    const promo = PROMOS[id];
    if (promo?.type === 'trial') return id;
  }
  return null;
};

export const getTrialDays = (): number => {
  for (const id of PLAN_ORDER) {
    const promo = PROMOS[id];
    if (promo?.type === 'trial') return promo.days;
  }
  return 0;
};

export const getPlanBadge = (planId: PlanId | string | undefined | null): string | undefined =>
  isPromoActive(planId) ? getPromo(planId)?.badge : undefined;

/** Plan por defecto para cuentas nuevas: el plan en prueba (si hay) o starter. */
export const NEW_ACCOUNT_PLAN: PlanId = getTrialPlan() ?? 'starter';

const isPromoTimedOut = (promo: PlanPromo | undefined): boolean => {
  if (!promo?.until) return false;
  const parsed = new Date(promo.until);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now();
};

/**
 * La promo está visible solo si no tiene fecha límite o aún no venció.
 * (El trial de 45 días por cuenta sigue siendo independiente de la fecha
 * de la oferta comercial.)
 */
export const isPromoActive = (planId: PlanId | string | undefined | null): boolean => {
  const promo = getPromo(planId);
  return !!promo && !isPromoTimedOut(promo);
};

export interface ActivePromo {
  planId: PlanId;
  promo: PlanPromo;
}

/** Primer plan con promo activa (para destacarlo en la landing/billing). */
export const getActivePromo = (): ActivePromo | null => {
  for (const id of PLAN_ORDER) {
    const promo = PROMOS[id];
    if (promo && !isPromoTimedOut(promo)) return { planId: id, promo };
  }
  return null;
};

export const getActivePromoPlan = (): PlanId | null => getActivePromo()?.planId ?? null;

/**
 * Fecha límite de la promo activa para el countdown de urgencia.
 * Si no hay promo, ya venció o `until` no es válido, se usa el fin del mes
 * en curso. Si `until` quedó en el pasado, la promo está expirada y el
 * countdown deja de mostrarse.
 */
export const getPromoDeadline = (active: ActivePromo | null = getActivePromo()): Date | null => {
  if (!active) return null;
  if (active.promo.until) {
    const parsed = new Date(active.promo.until);
    if (!Number.isNaN(parsed.getTime())) {
      if (parsed.getTime() <= Date.now()) return null;
      return parsed;
    }
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
};

/** Precio final con descuento aplicado (o precio base si no hay promo de descuento). */
export const getEffectivePrice = (planId: PlanId | string | undefined | null): number => {
  const base = (planId && PLANS[planId as PlanId]?.price) || 0;
  const promo = getPromo(planId);
  if (promo?.type === 'discount') return Math.round((base * (100 - promo.percent)) / 100);
  return base;
};

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    price: prices.starter,
    features: [
      { label: 'Productos', value: '50', included: true },
      { label: 'Usuarios', value: '1', included: true },
      { label: 'Sucursal', value: '1', included: true },
      { label: 'Stock', included: true },
      { label: 'Ventas', included: true },
      { label: 'Compras', included: true },
      { label: 'Código de barras', included: true },
      { label: 'Dashboard', value: 'Básico', included: true },
      { label: 'Reportes', value: 'Básicos', included: true },
    ],
  },
  business: {
    id: 'business',
    name: 'Business',
    price: prices.business,
    features: [
      { label: 'Productos', value: 'Ilimitados', included: true },
      { label: 'Usuarios', value: 'Ilimitados', included: true },
      { label: 'Sucursales', value: 'Hasta 5', included: true },
      { label: 'CRM', included: true },
      { label: 'Dashboard', value: 'Avanzado', included: true },
      { label: 'Pronóstico', value: 'Avanzado', included: true },
      { label: 'Reportes', value: 'Avanzados', included: true },
      { label: 'Historial', value: 'Completo', included: true },
      { label: 'Soporte', value: 'Prioritario', included: true },
      { label: 'Importación/exportación', included: true },
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: prices.enterprise,
    features: [
      { label: 'Productos', value: 'Ilimitados', included: true },
      { label: 'Usuarios', value: 'Ilimitados', included: true },
      { label: 'Sucursales', value: 'Ilimitadas', included: true },
      { label: 'CRM', included: true },
      { label: 'Dashboard', value: 'Avanzado', included: true },
      { label: 'Pronóstico', value: 'Avanzado', included: true },
      { label: 'Reportes', value: 'A medida', included: true },
      { label: 'Integraciones', value: 'Personalizadas', included: true },
      { label: 'Módulos', value: 'A medida', included: true },
      { label: 'Soporte', value: 'Dedicado + SLA', included: true },
      { label: 'Onboarding', value: 'Dedicado', included: true },
    ],
  },
};
