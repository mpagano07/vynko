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
  it('ofrece Mercado Pago como medio de pago', () => {
    render(<CheckoutModal {...baseProps} />);
    expect(screen.getByTitle('Mercado Pago (M)')).toBeInTheDocument();
  });

  it('oculta los medios desactivados en Preferencias', () => {
    render(<CheckoutModal {...baseProps} disabledMethods={['credit', 'mercadopago']} />);
    expect(screen.queryByTitle('Crédito (C)')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Mercado Pago (M)')).not.toBeInTheDocument();
    expect(screen.getByTitle('Efectivo (E)')).toBeInTheDocument();
  });

  it('arranca en el primer medio habilitado si el efectivo está oculto', () => {
    render(<CheckoutModal {...baseProps} disabledMethods={['cash']} />);
    expect(screen.queryByTitle('Efectivo (E)')).not.toBeInTheDocument();
    expect(screen.getByTitle('Transferencia (T)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Monto a cobrar')).toBeInTheDocument();
  });

  it('deshabilita dividir el pago cuando queda un solo medio habilitado', () => {
    render(
      <CheckoutModal
        {...baseProps}
        disabledMethods={['transfer', 'debit', 'credit', 'mercadopago']}
      />
    );
    expect(screen.getByRole('button', { name: /dividir pago/i })).toBeDisabled();
  });

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

  it('quita el descuento de efectivo al dividir el pago', () => {
    // El ajuste es sobre la venta completa: al repartir, cada porcion se cobra
    // a precio cheio y el total sigue siendo 100.
    render(<CheckoutModal {...baseProps} adjustments={adjustments({ cash: -10 })} />);
    fireEvent.click(screen.getByText('Dividir pago'));
    const cashInput = screen.getByLabelText('Monto del medio Efectivo');
    expect(cashInput).toHaveValue('100,00');
    expect(screen.queryByText(money(90))).not.toBeInTheDocument();
  });

  it('avisa que dividir el pago hace perder el descuento por medio de pago', () => {
    render(<CheckoutModal {...baseProps} adjustments={adjustments({ cash: -10 })} />);
    fireEvent.click(screen.getByText('Dividir pago'));
    expect(screen.getByText(/Al dividir el pago no se aplica el descuento/)).toBeInTheDocument();
  });

  it('mantiene el descuento de efectivo cuando no se divide el pago', () => {
    render(<CheckoutModal {...baseProps} adjustments={adjustments({ cash: -10 })} />);
    expect(screen.getAllByText(money(90)).length).toBeGreaterThan(0);
  });

  it('no muestra la nota de descuento del efectivo en un pago dividido', () => {
    render(<CheckoutModal {...baseProps} adjustments={adjustments({ cash: -10 })} />);
    fireEvent.click(screen.getByText('Dividir pago'));
    const cashInput = screen.getByLabelText('Monto del medio Efectivo');
    expect(cashInput).toHaveValue('100,00');
    expect(screen.queryByText(/^Descuento -10% =/)).not.toBeInTheDocument();
  });

  it('permite volver al monto exacto y ya no muestra billetes rápidos', () => {
    render(<CheckoutModal {...baseProps} adjustments={adjustments({ cash: 0 })} />);
    const received = screen.getByLabelText('Monto abonado');
    fireEvent.change(received, { target: { value: '250' } });
    expect(received).toHaveValue('250');

    fireEvent.click(screen.getByRole('button', { name: /monto exacto/i }));
    expect(received).toHaveValue('100,00');

    // Los atajos +$1k… +$20k se quitaron.
    expect(screen.queryByRole('button', { name: /^\+\$/ })).not.toBeInTheDocument();
  });

  it('muestra el banner destacado de vuelto al entregar cambio', () => {
    render(<CheckoutModal {...baseProps} adjustments={adjustments({ cash: 0 })} />);
    fireEvent.change(screen.getByLabelText('Monto abonado'), { target: { value: '1100' } });
    expect(screen.getByText(/Vuelto a entregar al cliente/i)).toBeInTheDocument();
  });
});

describe('CheckoutModal · hoja inferior en mobile', () => {
  it('se ancla al borde inferior y mantiene el total visible', () => {
    render(<CheckoutModal {...baseProps} />);

    expect(screen.getByText('Cobrar venta').closest('[data-modal-content]')).toHaveClass(
      'rounded-t-2xl'
    );
    expect(screen.getAllByText(money(100)).length).toBeGreaterThan(0);
  });

  it('bloquea la confirmación si el efectivo recibido no alcanza', () => {
    render(<CheckoutModal {...baseProps} />);

    fireEvent.change(screen.getByLabelText('Monto abonado'), { target: { value: '10' } });

    expect(screen.getByText(/faltan \$ 90,00/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirmar pago/i })).toBeDisabled();
  });
});
