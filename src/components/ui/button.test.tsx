import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './button';

describe('Button', () => {
  it('renders with default variant and size', () => {
    render(<Button>Guardar</Button>);
    const button = screen.getByRole('button', { name: 'Guardar' });
    expect(button.className).toContain('bg-indigo-600');
    expect(button.className).toContain('h-10');
  });

  it('applies the secondary variant', () => {
    render(<Button variant="secondary">Cancelar</Button>);
    expect(screen.getByRole('button', { name: 'Cancelar' }).className).toContain('bg-gray-200');
  });

  it('applies the sm size', () => {
    render(<Button size="sm">Ok</Button>);
    expect(screen.getByRole('button', { name: 'Ok' }).className).toContain('h-8');
  });

  it('merges an extra className', () => {
    render(<Button className="mt-4">Ok</Button>);
    expect(screen.getByRole('button', { name: 'Ok' }).className).toContain('mt-4');
  });

  it('is disabled when the disabled prop is set', () => {
    render(<Button disabled>Ok</Button>);
    expect(screen.getByRole('button', { name: 'Ok' })).toBeDisabled();
  });
});
