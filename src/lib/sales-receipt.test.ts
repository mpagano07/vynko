import { describe, expect, it } from 'vitest';
import { buildWhatsAppUrl, type ReceiptSale } from './sales-receipt';

function receiptText(sale: ReceiptSale): string {
  const url = new URL(buildWhatsAppUrl(sale, { name: 'Kiosco' }));
  return url.searchParams.get('text') ?? '';
}

function saleWith(overrides: Partial<ReceiptSale>): ReceiptSale {
  return {
    id: '511961cd-0000-0000-0000-000000000000',
    created_at: '2026-11-11T18:17:00.000Z',
    total_cents: 5563976,
    discount_cents: 0,
    surcharge_cents: 0,
    amount_paid_cents: 5563976,
    change_cents: 0,
    payment_method: 'cash',
    items: [],
    ...overrides,
  };
}

describe('buildWhatsAppUrl', () => {
  it('lista todos los medios del pago dividido', () => {
    const text = receiptText(
      saleWith({
        payments: [
          { method: 'cash', amount_cents: 2063976, received_cents: 2063976, change_cents: 0 },
          { method: 'transfer', amount_cents: 3500000, received_cents: 3500000, change_cents: 0 },
        ],
      })
    );

    expect(text).toContain('Efectivo:');
    expect(text).toContain('Transferencia:');
  });

  it('no repite el importe del producto cuando la cantidad es 1', () => {
    const text = receiptText(
      saleWith({
        items: [
          {
            product_name: 'Cámara Seguridad WiFi',
            quantity: 1,
            unit_price_cents: 4046988,
            subtotal_cents: 4046988,
          },
        ],
      })
    );

    expect(text).not.toContain('c/u');
  });

  it('muestra precio unitario y subtotal cuando la cantidad es mayor a 1', () => {
    const text = receiptText(
      saleWith({
        items: [
          {
            product_name: 'Café molido',
            quantity: 2,
            unit_price_cents: 75000,
            subtotal_cents: 150000,
          },
        ],
      })
    );

    expect(text).toContain('c/u');
  });
});
