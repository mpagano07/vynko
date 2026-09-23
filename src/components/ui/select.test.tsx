import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './select';

describe('Select', () => {
  it('renders a button trigger with default styles (input style)', () => {
    render(
      <Select data-testid="select">
        <option value="1">Opcion 1</option>
      </Select>
    );
    const trigger = screen.getByTestId('select');

    expect(trigger).toBeInTheDocument();
    expect(trigger.tagName).toBe('BUTTON');
    // Base classes matching the Input component
    expect(trigger).toHaveClass('flex', 'h-10', 'w-full', 'rounded-md', 'border', 'bg-white', 'shadow-sm');
  });

  it('shows a placeholder-style label when nothing is selected', () => {
    render(
      <Select data-testid="select" value="">
        <option value="">Seleccionar categoria...</option>
        <option value="1">Opcion 1</option>
      </Select>
    );
    const trigger = screen.getByTestId('select');
    const span = trigger.querySelector('span') as HTMLSpanElement;

    expect(trigger).toHaveTextContent('Seleccionar categoria...');
    expect(span).toHaveClass('text-gray-500');
  });

  it('merges visual className into the trigger and layout classes into the wrapper', () => {
    render(
      <Select data-testid="select" className="w-36 max-w-xs flex-1 bg-red-500 custom-select">
        <option value="1">Opcion 1</option>
      </Select>
    );
    const trigger = screen.getByTestId('select');
    const wrapper = trigger.closest('div') as HTMLDivElement;

    expect(trigger).toHaveClass('bg-red-500', 'custom-select', 'flex', 'h-10');
    expect(wrapper).toHaveClass('relative', 'w-36', 'max-w-xs', 'flex-1');
    expect(trigger).not.toHaveClass('w-36', 'flex-1');
  });

  it('can be disabled', () => {
    render(
      <Select data-testid="select" disabled>
        <option value="1">Opcion 1</option>
      </Select>
    );
    const trigger = screen.getByTestId('select');

    expect(trigger).toBeDisabled();
    expect(trigger).toHaveClass('disabled:cursor-not-allowed', 'disabled:opacity-50');
  });

  it('shows the selected option label and fires onChange when an option is clicked', () => {
    const handleChange = vi.fn();
    render(
      <Select data-testid="select" value="2" onChange={handleChange}>
        <option value="1">Opcion 1</option>
        <option value="2">Opcion 2</option>
      </Select>
    );
    const trigger = screen.getByTestId('select');

    expect(trigger).toHaveTextContent('Opcion 2');

    fireEvent.click(trigger);
    expect(screen.getByRole('option', { name: 'Opcion 1' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'Opcion 1' }));
    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange.mock.calls[0][0].target.value).toBe('1');
  });

  it('supports defaultValue when uncontrolled', () => {
    render(
      <Select data-testid="select" defaultValue="2">
        <option value="1">Opcion 1</option>
        <option value="2">Opcion 2</option>
      </Select>
    );
    const trigger = screen.getByTestId('select');

    expect(trigger).toHaveTextContent('Opcion 2');
  });

  it('forwards ref correctly', () => {
    const selectRef = { current: null as HTMLDivElement | null };
    render(
      <Select
        data-testid="select"
        ref={(el) => {
          selectRef.current = el;
        }}
      >
        <option value="1">Opcion 1</option>
      </Select>
    );

    expect(selectRef.current).not.toBeNull();
    expect(selectRef.current?.tagName).toBe('DIV');
  });
});