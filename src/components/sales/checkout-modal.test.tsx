import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutModal } from './checkout-modal';
import {
  DEFAULT_PAYMENT_ADJUSTMENTS,
  type PaymentAdjustments,
} from '@/lib/payment-methods';
import { formatARS } from '@/lib/utils/currency';

function adjustments(overrides: Partial<PaymentAdjustments> = {}): PaymentAdjustments {
  return { ...DEFAULT_PAYMENT_ADJUSTMENTS, ...overrides };
}

/** El formateador usa espacio no separable; el matcher de Testing Library lo normaliza. */
function money(value: number): string {
  return formatARS(value).replace(/\u00a0/g, ' ');
}

const baseProps = {
  total: 100,
  adjustments: adjustments(),
  onClose: vi.fn(),
  onConfirm: vi.fn(),
};

describe('CheckoutModal · ajustes automáticos por medio de pago', () => {
  it('precarga el efectivo con el monto ya descontado', () => {
    render(<CheckoutModal {...baseProps} adjustments={adjustments({ cash: -10 })} />);
    expect(screen.getByLabelText('Monto abonado')).toHaveValue('90,00');
  });

  it('precarga el efectivo con el monto ya recargado', () => {
    render(<CheckoutModal {...baseProps} adjustments={adjustments({ cash: 10 })} />);
    expect(screen.getByLabelText('Monto abonado')).toHaveValue('110,00');
  });

  it('actualiza el monto a cobrar al cambiar a un medio con recargo', () => {
    render(<CheckoutModal {...baseProps} adjustments={adjustments({ credit: 10 })} />);
    fireEvent.click(screen.getByTitle('Crédito (C)'));
    expect(screen.getByText('Monto a cobrar')).toBeInTheDocument();
    expect(screen.getAllByText(money(110)).length).toBeGreaterThan(0);
  });

  it('actualiza el monto a cobrar al cambiar a un medio con descuento', () => {
    render(<CheckoutModal {...baseProps} adjustments={adjustments({ transfer: -20 })} />);
    fireEvent.click(screen.getByTitle('Transferencia (T)'));
    expect(screen.getAllByText(money(80)).length).toBeGreaterThan(0);
  });

  it('confirma el reparto base enviando el efectivo ya ajustado como recibido', () => {
    const onConfirm = vi.fn();
    render(
      <CheckoutModal
        {...baseProps}
        adjustments={adjustments({ cash: -10 })}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /confirmar pago/i }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        payments: [{ method: 'cash', amount: 100, received: 90 }],
        primary: 'cash',
      })
    );
  });

  it('muestra el badge del ajuste solo en el botón del medio correspondiente', () => {
    render(
      <CheckoutModal {...baseProps} adjustments={adjustments({ cash: -10, credit: 10 })} />
    );
    const cashButton = screen.getByTitle('Efectivo (E)');
    const creditButton = screen.getByTitle('Crédito (C)');
    expect(cashButton.textContent).toContain('-10%');
    expect(cashButton.textContent).not.toContain('+10%');
    expect(creditButton.textContent).toContain('+10%');
    expect(creditButton.textContent).not.toContain('-10%');
  });

  it('nombra el ajuste negativo "Descuento" y el positivo "Recargo"', () => {
    render(
      <CheckoutModal {...baseProps} adjustments={adjustments({ cash: -10, credit: 10 })} />
    );
    expect(screen.getByText(/^Descuento -10% =/)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Crédito (C)'));
    expect(screen.getByText(/^Recargo \+10% =/)).toBeInTheDocument();
  });

  it('no pierde el descuento en efectivo al dividir el pago', () => {
    render(<CheckoutModal {...baseProps} adjustments={adjustments({ cash: -10 })} />);
    fireEvent.click(screen.getByText('Dividir pago'));
    const cashInput = screen.getByLabelText('Monto del medio Efectivo');
    expect(cashInput).toHaveValue('100,00');
    expect(screen.getAllByText(money(90)).length).toBeGreaterThan(0);
  });

  it('no muestra la nota de descuento del efectivo en un pago dividido', () => {
    render(<CheckoutModal {...baseProps} adjustments={adjustments({ cash: -10 })} />);
    fireEvent.click(screen.getByText('Dividir pago'));
    const cashInput = screen.getByLabelText('Monto del medio Efectivo');
    expect(cashInput).toHaveValue('100,00');
    expect(screen.queryByText(/^Descuento -10% =/)).not.toBeInTheDocument();
  });
});
