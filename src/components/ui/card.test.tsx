import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from './card';

describe('Card', () => {
  it('renders correctly with default styles', () => {
    render(
      <Card data-testid="card">
        <p>Contenido</p>
      </Card>
    );
    const card = screen.getByTestId('card');
    
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass('rounded-lg', 'bg-white', 'shadow-sm', 'p-4');
  });

  it('applies outline variant correctly', () => {
    render(
      <Card data-testid="card" variant="outline">
        <p>Contenido</p>
      </Card>
    );
    const card = screen.getByTestId('card');
    
    expect(card).toHaveClass('border', 'border-gray-200');
  });

  it('merges custom className with default styles', () => {
    render(
      <Card data-testid="card" className="bg-red-500 custom-card">
        <p>Contenido</p>
      </Card>
    );
    const card = screen.getByTestId('card');
    
    expect(card).toHaveClass('bg-red-500', 'custom-card', 'rounded-lg');
  });

  it('forwards ref correctly', () => {
    const cardRef = { current: null as HTMLDivElement | null };
    render(
      <Card
        data-testid="card"
        ref={(el) => {
          cardRef.current = el;
        }}
      >
        <p>Contenido</p>
      </Card>
    );
    
    expect(cardRef.current).not.toBeNull();
    expect(cardRef.current?.tagName).toBe('DIV');
  });
});
