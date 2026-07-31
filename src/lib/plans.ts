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
  badge?: string;
  comingSoon?: boolean;
  features: PlanFeature[];
};

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 19900,
    badge: '45 días gratis',
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
    price: 34900,
    badge: '45 días gratis',
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
    price: 0,
    badge: 'Próximamente',
    comingSoon: true,
    features: [],
  },
};
