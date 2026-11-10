import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/** Simula el alto real del ticket en el navegador (jsdom siempre mide 0). */
function mockReceiptHeight(heightPx: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 219,
    bottom: heightPx,
    width: 219,
    height: heightPx,
    toJSON: () => ({}),
  } as DOMRect);
}

function printCss() {
  return document.body.querySelector('style')?.textContent ?? '';
}

describe('PrintReceipt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

    const css = printCss();
    expect(css).toContain('body > *:not(#receipt-print-portal) { display: none !important; }');
    expect(css).toContain('display: block !important;');
    // `visibility: hidden` conservaba el layout y desplazaba el ticket fuera
    // del área imprimible según el scroll.
    expect(css).not.toContain('visibility: hidden');
  });

  it('declara el papel configurado en @page (si no, imprime en el tamaño del driver)', () => {
    mockReceiptHeight(400); // 400px ≈ 105.8mm -> 108mm con el margen de corte
    const { rerender } = render(
      <PrintReceipt sale={sale} tenant={tenant} paperSize="58mm" />
    );
    expect(printCss()).toContain('size: 58mm 108mm;');

    rerender(<PrintReceipt sale={sale} tenant={tenant} paperSize="80mm" />);
    expect(printCss()).toContain('size: 80mm 108mm;');
  });

  it('escala el contenido completo con el papel, no solo los márgenes', () => {
    const { rerender } = render(
      <PrintReceipt sale={sale} tenant={tenant} paperSize="58mm" />
    );
    const area = () => document.getElementById('receipt-print-area') as HTMLElement;
    expect(area().style.width).toBe('58mm');
    expect(area().style.fontSize).toBe('2.9mm');

    rerender(<PrintReceipt sale={sale} tenant={tenant} paperSize="80mm" />);
    expect(area().style.width).toBe('80mm');
    // 80/58 ≈ 1,379: la tipografía crece con el papel en vez de quedar chica.
    expect(area().style.fontSize).toBe('4mm');
  });
});
