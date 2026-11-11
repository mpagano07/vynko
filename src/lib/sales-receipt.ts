/**
 * Formato puro del comprobante de venta (texto y link de WhatsApp).
 *
 * Vive separado de `components/sales/receipt-modal.tsx` para que las pantallas
 * que solo necesitan compartir el ticket por WhatsApp no arrastren el modal de
 * impresión ni sus iconos al bundle inicial. Sin dependencias de React.
 */

import { getPaymentMethodLabel } from '@/lib/payment-methods';
import { formatARS } from '@/lib/utils/currency';

export interface ReceiptSale {
  id: string;
  created_at?: string | null;
  total_cents: number;
  discount_cents: number;
  surcharge_cents: number;
  amount_paid_cents: number;
  change_cents: number;
  payment_method?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  notes?: string | null;
  items: {
    product_name: string;
    quantity: number;
    unit_price_cents: number;
    subtotal_cents: number;
  }[];
  payments?: {
    method: string;
    amount_cents: number;
    received_cents: number;
    change_cents: number;
  }[];
  adjustments_applied?: Record<string, number>;
}

export interface ReceiptTenant {
  name?: string | null;
  company_name?: string | null;
  business_address?: string | null;
  business_phone?: string | null;
}

export function formatReceiptDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildWhatsAppText(sale: ReceiptSale, tenant: ReceiptTenant): string {
  const lines: string[] = [];
  lines.push('🧾 *COMPROBANTE DE VENTA*');
  lines.push('');
  if (tenant.company_name) lines.push(tenant.company_name);
  if (tenant.name) lines.push(tenant.name);
  if (tenant.business_address) lines.push(tenant.business_address);
  if (tenant.business_phone) lines.push(`Tel: ${tenant.business_phone}`);
  lines.push(`Fecha: ${formatReceiptDate(sale.created_at)}`);
  lines.push(`${sale.id.slice(0, 8).toUpperCase()}`);
  lines.push('------------------------------');
  for (const item of sale.items) {
    lines.push(`${item.quantity} x ${item.product_name}`);
    if (item.quantity > 1) {
      lines.push(`    ${formatARS(item.unit_price_cents / 100)} c/u = ${formatARS(item.subtotal_cents / 100)}`);
    } else {
      lines.push(`    ${formatARS(item.subtotal_cents / 100)}`);
    }
  }
  lines.push('------------------------------');
  if (sale.discount_cents > 0) lines.push(`Descuento: -${formatARS(sale.discount_cents / 100)}`);
  if (sale.surcharge_cents > 0) lines.push(`Recargo: +${formatARS(sale.surcharge_cents / 100)}`);
  lines.push(`TOTAL: ${formatARS(sale.total_cents / 100)}`);
  const payments =
    sale.payments && sale.payments.length > 0
      ? sale.payments
      : [
          {
            method: sale.payment_method ?? 'cash',
            amount_cents: sale.total_cents,
            received_cents: sale.amount_paid_cents,
            change_cents: sale.change_cents,
          },
        ];
  for (const p of payments) {
    const label = getPaymentMethodLabel(p.method);
    lines.push(`${label}: ${formatARS(p.amount_cents / 100)}`);
    if (p.change_cents > 0) lines.push(`Vuelto: ${formatARS(p.change_cents / 100)}`);
  }
  if (sale.notes) lines.push('');
  if (sale.notes) lines.push(`Nota: ${sale.notes}`);
  lines.push('');
  lines.push('¡Gracias por tu compra!');
  return lines.join('\n');
}

export function buildWhatsAppUrl(sale: ReceiptSale, tenant: ReceiptTenant): string {
  const text = buildWhatsAppText(sale, tenant);
  if (sale.customer_phone) {
    const digits = sale.customer_phone.replace(/\D/g, '');
    const phone = digits.replace(/^0+/, '');
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
}
