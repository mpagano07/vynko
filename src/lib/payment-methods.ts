export const PAYMENT_METHODS = [
  { id: 'cash', label: 'Efectivo', hotkey: 'E' },
  { id: 'transfer', label: 'Transferencia', hotkey: 'T' },
  { id: 'debit', label: 'Débito', hotkey: 'D' },
  { id: 'credit', label: 'Crédito', hotkey: 'C' },
  { id: 'mercadopago', label: 'Mercado Pago', hotkey: 'M' },
] as const;

export type PaymentMethodId = (typeof PAYMENT_METHODS)[number]['id'];

export function isPaymentMethodId(value: string): value is PaymentMethodId {
  return PAYMENT_METHODS.some((m) => m.id === value);
}

export function getPaymentMethodLabel(id: string | undefined | null): string {
  const method = PAYMENT_METHODS.find((m) => m.id === id);
  return method?.label ?? 'Efectivo';
}

/**
 * Ajustes automáticos por medio de pago (porcentajes sobre el total).
 * Negativo = descuento (ej: -10 para 10% off en efectivo), positivo = recargo.
 */
export type PaymentAdjustments = Record<PaymentMethodId, number>;

export interface CheckoutSettings {
  payment_adjustments: PaymentAdjustments;
  paper_size: '58mm' | '80mm';
  show_receipt: boolean;
}

export const DEFAULT_PAYMENT_ADJUSTMENTS: PaymentAdjustments = {
  cash: 0,
  transfer: 0,
  debit: 0,
  credit: 0,
  mercadopago: 0,
};

export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  payment_adjustments: DEFAULT_PAYMENT_ADJUSTMENTS,
  paper_size: '58mm',
  show_receipt: true,
};

/**
 * Normaliza el objeto `checkout` de `tenants.settings` (JSONB) a una
 * configuración segura, con valores por defecto cuando faltan o son inválidos.
 */
export function normalizeCheckoutSettings(settings: unknown): CheckoutSettings {
  const s =
    typeof settings === 'object' && settings !== null
      ? (settings as Record<string, unknown>)
      : {};
  const rawAdjustments = s.payment_adjustments as Record<string, unknown> | undefined;
  const adjustments: PaymentAdjustments = { ...DEFAULT_PAYMENT_ADJUSTMENTS };
  if (rawAdjustments && typeof rawAdjustments === 'object') {
    for (const method of PAYMENT_METHODS) {
      const value = rawAdjustments[method.id];
      if (typeof value === 'number' && Number.isFinite(value)) {
        adjustments[method.id] = Math.max(-100, Math.min(100, value));
      }
    }
  }
  return {
    payment_adjustments: adjustments,
    paper_size: s.paper_size === '80mm' ? '80mm' : '58mm',
    show_receipt: typeof s.show_receipt === 'boolean' ? s.show_receipt : true,
  };
}