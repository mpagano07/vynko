import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './modal';

describe('Modal', () => {
  it('renders overlay with title and children when open', () => {
    render(
      <Modal open onClose={vi.fn()} title="Mi modal">
        <p>Contenido</p>
      </Modal>
    );

    expect(screen.getByText('Mi modal')).toBeInTheDocument();
    expect(screen.getByText('Contenido')).toBeInTheDocument();
  });

  it('returns null when not open', () => {
    const { container } = render(
      <Modal open={false} onClose={vi.fn()} title="Mi modal">
        <p>Contenido</p>
      </Modal>
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders a close button that calls onClose', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <p>Contenido</p>
      </Modal>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders with an icon next to the title', () => {
    render(
      <Modal open onClose={vi.fn()} icon={<span data-testid="icono">*</span>} title="Con icono">
        <p>Contenido</p>
      </Modal>
    );

    expect(screen.getByTestId('icono')).toBeInTheDocument();
  });

  it('renders the panel variant with a header bar', () => {
    render(
      <Modal open onClose={vi.fn()} panel header={<h3>Header panel</h3>} className="max-w-sm">
        <p>Contenido</p>
      </Modal>
    );

    expect(screen.getByText('Header panel')).toBeInTheDocument();
    expect(screen.getByText('Contenido')).toBeInTheDocument();
  });
});