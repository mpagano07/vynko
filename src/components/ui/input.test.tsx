import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from './input';

describe('Input', () => {
  it('renders correctly with default styles', () => {
    render(<Input placeholder="Buscar..." />);
    const input = screen.getByPlaceholderText('Buscar...');
    
    expect(input).toBeInTheDocument();
    // Default base classes from cn
    expect(input).toHaveClass('flex', 'h-10', 'w-full', 'rounded-md', 'border');
  });

  it('applies outline variant correctly', () => {
    render(<Input placeholder="Buscar..." variant="outline" />);
    const input = screen.getByPlaceholderText('Buscar...');
    
    expect(input).toHaveClass('border-2', 'border-gray-400');
  });

  it('merges custom className with default styles', () => {
    render(<Input placeholder="Buscar..." className="bg-red-500 custom-input" />);
    const input = screen.getByPlaceholderText('Buscar...');
    
    expect(input).toHaveClass('bg-red-500', 'custom-input', 'flex', 'h-10');
  });

  it('can be disabled', () => {
    render(<Input placeholder="Buscar..." disabled />);
    const input = screen.getByPlaceholderText('Buscar...');
    
    expect(input).toBeDisabled();
    expect(input).toHaveClass('disabled:cursor-not-allowed', 'disabled:opacity-50');
  });

  it('forwards ref correctly', () => {
    let inputRef: HTMLInputElement | null = null;
    render(
      <Input
        placeholder="Buscar..."
        ref={(el) => {
          inputRef = el;
        }}
      />
    );
    
    expect(inputRef).not.toBeNull();
    expect(inputRef?.tagName).toBe('INPUT');
  });
});
