import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StickySaveBar } from './sticky-save-bar';

describe('StickySaveBar', () => {
  it('no renderiza nada si no hay cambios', () => {
    const { container } = render(
      <StickySaveBar open={false} onDiscard={vi.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('muestra el aviso y envía el formulario que lo contiene', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <StickySaveBar open onDiscard={vi.fn()} />
      </form>
    );

    expect(screen.getByText('Tenés cambios sin guardar')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('descarta los cambios sin enviar', () => {
    const onDiscard = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <StickySaveBar open onDiscard={onDiscard} />
      </form>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('bloquea las acciones mientras guarda', () => {
    render(<StickySaveBar open saving onDiscard={vi.fn()} />);

    expect(screen.getByRole('button', { name: /guardando/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeDisabled();
  });
});
