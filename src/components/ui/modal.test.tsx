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

  it('ancla la variante sheet al borde inferior', () => {
    render(
      <Modal open onClose={vi.fn()} panel sheet className="max-w-sm">
        <p>Contenido</p>
      </Modal>
    );

    expect(screen.getByRole('dialog').firstElementChild).toHaveClass('items-end');
    expect(screen.getByText('Contenido').closest('[data-modal-content]')).toHaveClass(
      'rounded-t-2xl'
    );
  });

  it('deja scrollear el overlay cuando el contenido no entra en la pantalla', () => {
    render(
      <Modal open onClose={vi.fn()} title="Mi modal">
        <p>Contenido</p>
      </Modal>
    );

    expect(screen.getByRole('dialog')).toHaveClass('overflow-y-auto');
  });

  it('cierra al hacer click en el fondo cuando backdropClose está activo', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} backdropClose title="Mi modal">
        <p>Contenido</p>
      </Modal>
    );

    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cierra con la tecla Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Mi modal">
        <p>Contenido</p>
      </Modal>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('con modales apilados, Escape cierra solo el último', () => {
    const onCloseFirst = vi.fn();
    const onCloseSecond = vi.fn();
    render(
      <>
        <Modal open onClose={onCloseFirst} title="Primero">
          <p>Primero</p>
        </Modal>
        <Modal open onClose={onCloseSecond} title="Segundo">
          <p>Segundo</p>
        </Modal>
      </>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseSecond).toHaveBeenCalledTimes(1);
    expect(onCloseFirst).not.toHaveBeenCalled();
  });

  it('no cierra al hacer click dentro del contenido', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} backdropClose title="Mi modal">
        <p>Contenido</p>
      </Modal>
    );

    fireEvent.mouseDown(screen.getByText('Contenido'));
    expect(onClose).not.toHaveBeenCalled();
  });
});