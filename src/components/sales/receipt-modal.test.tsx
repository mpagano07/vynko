import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PrintReceipt } from './receipt-modal';
import type { ReceiptSale, ReceiptTenant } from '@/lib/sales-receipt';

const sale: ReceiptSale = {
  id: 'abcdef12-3456-7890-abcd-ef1234567890',
  created_at: '2026-11-10T18:30:00.000Z',
  total_cents: 150000,
  discount_cents: 0,
  surcharge_cents: 0,
  amount_paid_cents: 150000,
  change_cents: 0,
  payment_method: 'cash',
  items: [
    {
      product_name: 'Café molido',
      quantity: 2,
      unit_price_cents: 75000,
      subtotal_cents: 150000,
    },
  ],
};

const tenant: ReceiptTenant = {
  name: 'Kiosco de prueba',
  business_address: 'Av. Siempre Viva 742',
};

describe('PrintReceipt', () => {
  it('monta el ticket en un portal como hijo directo de body', () => {
    const { container } = render(
      <PrintReceipt sale={sale} tenant={tenant} paperSize="58mm" />
    );

    const area = document.getElementById('receipt-print-area');
    expect(area).not.toBeNull();
    // Fuera del árbol de la página: así el ticket no hereda el scroll ni el
    // layout del resto de la app al imprimir.
    expect(container.contains(area)).toBe(false);
    expect(area?.parentElement?.parentElement).toBe(document.body);
    expect(screen.getByText('TOTAL')).toBeInTheDocument();
  });

  it('oculta el resto de la app en impresión con display: none, no visibility', () => {
    render(<PrintReceipt sale={sale} tenant={tenant} paperSize="58mm" />);

    const css = document.body.querySelector('style')?.textContent ?? '';
    expect(css).toContain('body > *:not(#receipt-print-portal) { display: none !important; }');
    expect(css).toContain('#receipt-print-portal { display: none; }');
    expect(css).toContain('@page { margin: 0; }');
    // `visibility: hidden` conservaba el layout y desplazaba el ticket fuera
    // del área imprimible según el scroll.
    expect(css).not.toContain('visibility: hidden');
  });

  it('usa el ancho del papel configurado', () => {
    const { rerender } = render(
      <PrintReceipt sale={sale} tenant={tenant} paperSize="58mm" />
    );
    const area = () => document.getElementById('receipt-print-area');
    expect(area()?.style.width).toBe('58mm');

    rerender(<PrintReceipt sale={sale} tenant={tenant} paperSize="80mm" />);
    expect(area()?.style.width).toBe('80mm');
  });
});
