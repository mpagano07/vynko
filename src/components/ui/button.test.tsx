import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './button';

describe('Button', () => {
  it('renders with default variant and size', () => {
    render(<Button>Guardar</Button>);
    const button = screen.getByRole('button', { name: 'Guardar' });
    expect(button.className).toContain('bg-indigo-600');
    expect(button.className).toContain('min-h-10');
  });

  it('applies the secondary variant', () => {
    render(<Button variant="secondary">Cancelar</Button>);
    expect(screen.getByRole('button', { name: 'Cancelar' }).className).toContain('bg-gray-200');
  });

  it('applies the sm size', () => {
    render(<Button size="sm">Ok</Button>);
    expect(screen.getByRole('button', { name: 'Ok' }).className).toContain('min-h-8');
  });

  it('merges an extra className', () => {
    render(<Button className="mt-4">Ok</Button>);
    expect(screen.getByRole('button', { name: 'Ok' }).className).toContain('mt-4');
  });

  it('applies the danger variant', () => {
    render(<Button variant="danger">Eliminar</Button>);
    expect(screen.getByRole('button', { name: 'Eliminar' }).className).toContain('bg-rose-600');
  });

  it('applies the ghost variant', () => {
    render(<Button variant="ghost">Cancelar</Button>);
    expect(screen.getByRole('button', { name: 'Cancelar' }).className).toContain('hover:bg-gray-100');
  });

  it('shows a spinner and disables the button while loading', () => {
    render(<Button loading>Guardando</Button>);
    const button = screen.getByRole('button', { name: 'Guardando' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('is disabled when the disabled prop is set', () => {
    render(<Button disabled>Ok</Button>);
    expect(screen.getByRole('button', { name: 'Ok' })).toBeDisabled();
  });
});
