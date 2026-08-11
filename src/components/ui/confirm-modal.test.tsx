import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmModal } from './confirm-modal';

describe('ConfirmModal', () => {
  const defaultProps = {
    open: true,
    title: 'Confirmar acción',
    message: '¿Estás seguro?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('does not render when open is false', () => {
    render(<ConfirmModal {...defaultProps} open={false} />);
    expect(screen.queryByText('Confirmar acción')).not.toBeInTheDocument();
  });

  it('renders title and message when open is true', () => {
    render(<ConfirmModal {...defaultProps} />);
    expect(screen.getByText('Confirmar acción')).toBeInTheDocument();
    expect(screen.getByText('¿Estás seguro?')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    render(<ConfirmModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Confirmar'));
    expect(defaultProps.onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    render(<ConfirmModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancelar'));
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when X button is clicked', () => {
    render(<ConfirmModal {...defaultProps} />);
    // The X button contains the SVG, we can find it by getting the button that is not 'Cancelar' or 'Confirmar'
    // but the easiest way is to find the close button.
    const closeButtons = screen.getAllByRole('button');
    // It should be the first button (the absolute one with the X icon)
    fireEvent.click(closeButtons[0]);
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('shows custom labels', () => {
    render(
      <ConfirmModal
        {...defaultProps}
        confirmLabel="Sí, borrar"
        cancelLabel="No, mantener"
      />
    );
    expect(screen.getByText('Sí, borrar')).toBeInTheDocument();
    expect(screen.getByText('No, mantener')).toBeInTheDocument();
  });

  it('shows loading state on confirm button', () => {
    render(<ConfirmModal {...defaultProps} loading={true} />);
    expect(screen.getByText('Procesando...')).toBeInTheDocument();
    expect(screen.getByText('Procesando...')).toBeDisabled();
    expect(screen.getByText('Cancelar')).toBeDisabled();
  });

  it('applies danger styling', () => {
    render(<ConfirmModal {...defaultProps} variant="danger" />);
    const confirmButton = screen.getByText('Confirmar');
    expect(confirmButton).toHaveClass('!bg-red-600');
  });
});
