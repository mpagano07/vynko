import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CANCEL_REASONS,
  CancelSubscriptionModal,
} from './cancel-subscription-modal';

function setup() {
  const onClose = vi.fn();
  const onSupport = vi.fn();
  const onContinue = vi.fn();

  render(
    <CancelSubscriptionModal
      onClose={onClose}
      onSupport={onSupport}
      onContinue={onContinue}
      periodEndLabel="31/12/2026"
    />
  );

  return { onClose, onSupport, onContinue };
}

describe('CancelSubscriptionModal', () => {
  it('muestra el paso de retención con los motivos y la fecha de acceso', () => {
    setup();

    expect(screen.getByRole('heading', { name: 'Antes de cancelar' })).toBeInTheDocument();
    expect(screen.getByText(/31\/12\/2026/)).toBeInTheDocument();
    for (const reason of CANCEL_REASONS) {
      expect(screen.getByLabelText(reason.label)).toBeInTheDocument();
    }
  });

  it('permite mantener el plan sin cancelar', () => {
    const { onClose, onContinue } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Mantener mi plan' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('abre soporte sin cancelar', () => {
    const { onSupport, onContinue } = setup();

    fireEvent.click(screen.getByRole('button', { name: /hablar con soporte/i }));

    expect(onSupport).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('continúa con la baja y devuelve el motivo elegido', () => {
    const { onContinue } = setup();

    fireEvent.click(screen.getByLabelText('Me resulta caro'));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar con la baja' }));

    expect(onContinue).toHaveBeenCalledWith('price');
  });

  it('permite continuar sin elegir un motivo', () => {
    const { onContinue } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar con la baja' }));

    expect(onContinue).toHaveBeenCalledWith(null);
  });
});
