import { describe, expect, it } from 'vitest';
import {
  buildWhatsAppUrl,
  normalizeWhatsAppPhone,
  type ReceiptSale,
  type ReceiptTenant,
} from './sales-receipt';

function receiptText(sale: ReceiptSale, tenant: ReceiptTenant = { name: 'Kiosco' }): string {
  const url = new URL(buildWhatsAppUrl(sale, tenant));
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

  it('no repite el nombre del comercio cuando company_name y name son iguales', () => {
    const text = receiptText(saleWith({}), { name: 'Kiosco', company_name: 'Kiosco' });

    expect(text.match(/Kiosco/g)).toHaveLength(1);
  });

  it('mantiene ambos nombres cuando son distintos', () => {
    const text = receiptText(saleWith({}), { name: 'Sucursal Centro', company_name: 'Kiosco' });

    expect(text).toContain('Kiosco');
    expect(text).toContain('Sucursal Centro');
  });
});

describe('normalizeWhatsAppPhone', () => {
  it('agrega el código de país a un celular argentino de 10 dígitos', () => {
    expect(normalizeWhatsAppPhone('1165602587')).toBe('5491165602587');
  });

  it('acepta el número ya internacionalizado sin duplicar el 54 ni el 9', () => {
    expect(normalizeWhatsAppPhone('+54 9 11 6560-2587')).toBe('5491165602587');
    expect(normalizeWhatsAppPhone('5491165602587')).toBe('5491165602587');
    expect(normalizeWhatsAppPhone('0054 9 11 6560 2587')).toBe('5491165602587');
  });

  it('quita el 0 y el 15 del formato local', () => {
    expect(normalizeWhatsAppPhone('011 15 6560-2587')).toBe('5491165602587');
    expect(normalizeWhatsAppPhone('11 15 6560 2587')).toBe('5491165602587');
    expect(normalizeWhatsAppPhone('0221 15 555-1234')).toBe('5492215551234');
  });

  it('deja intacto un número internacional de otro país', () => {
    expect(normalizeWhatsAppPhone('+1 555 123 4567')).toBe('15551234567');
  });

  it('devuelve vacío si no hay dígitos', () => {
    expect(normalizeWhatsAppPhone('')).toBe('');
    expect(normalizeWhatsAppPhone('sin número')).toBe('');
  });

  it('usa el teléfono normalizado en el link de WhatsApp', () => {
    const url = buildWhatsAppUrl(saleWith({ customer_phone: '1165602587' }), { name: 'Kiosco' });

    expect(url.startsWith('https://wa.me/5491165602587?text=')).toBe(true);
  });
});
