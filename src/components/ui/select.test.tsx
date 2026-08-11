import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Select } from './select';

describe('Select', () => {
  it('renders correctly with default styles', () => {
    render(
      <Select data-testid="select">
        <option value="1">Opcion 1</option>
      </Select>
    );
    const select = screen.getByTestId('select');
    
    expect(select).toBeInTheDocument();
    // Default base classes from cn
    expect(select).toHaveClass('flex', 'h-10', 'w-full', 'rounded-md', 'border');
  });

  it('applies outline variant correctly', () => {
    render(
      <Select data-testid="select" variant="outline">
        <option value="1">Opcion 1</option>
      </Select>
    );
    const select = screen.getByTestId('select');
    
    expect(select).toHaveClass('border-2', 'border-gray-400');
  });

  it('merges custom className with default styles', () => {
    render(
      <Select data-testid="select" className="bg-red-500 custom-select">
        <option value="1">Opcion 1</option>
      </Select>
    );
    const select = screen.getByTestId('select');
    
    expect(select).toHaveClass('bg-red-500', 'custom-select', 'flex', 'h-10');
  });

  it('can be disabled', () => {
    render(
      <Select data-testid="select" disabled>
        <option value="1">Opcion 1</option>
      </Select>
    );
    const select = screen.getByTestId('select');
    
    expect(select).toBeDisabled();
    expect(select).toHaveClass('disabled:cursor-not-allowed', 'disabled:opacity-50');
  });

  it('renders children options correctly', () => {
    render(
      <Select data-testid="select" defaultValue="2">
        <option value="1">Opcion 1</option>
        <option value="2">Opcion 2</option>
      </Select>
    );
    const select = screen.getByTestId('select') as HTMLSelectElement;
    
    expect(select.options.length).toBe(2);
    expect(select.value).toBe('2');
  });

  it('forwards ref correctly', () => {
    let selectRef: HTMLSelectElement | null = null;
    render(
      <Select
        data-testid="select"
        ref={(el) => {
          selectRef = el;
        }}
      >
        <option value="1">Opcion 1</option>
      </Select>
    );
    
    expect(selectRef).not.toBeNull();
    expect(selectRef?.tagName).toBe('SELECT');
  });
});
