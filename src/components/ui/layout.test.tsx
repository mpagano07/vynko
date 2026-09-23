import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Users } from 'lucide-react';
import { LoadingState } from './loading-state';
import { EmptyState } from './empty-state';
import { SearchInput } from './search-input';
import { Thead, Th } from './table-header';

describe('LoadingState', () => {
  it('renders an optional label', () => {
    render(<LoadingState label="Cargando..." />);
    expect(screen.getByText('Cargando...')).toBeInTheDocument();
  });

  it('renders compact without a label', () => {
    const { container } = render(<LoadingState compact />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders icon, title, description and action', () => {
    render(
      <EmptyState
        icon={Users}
        title="Sin clientes"
        description="Agrega tu primer cliente."
        action={<button>Crear</button>}
      />
    );
    expect(screen.getByText('Sin clientes')).toBeInTheDocument();
    expect(screen.getByText('Agrega tu primer cliente.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear' })).toBeInTheDocument();
  });

  it('does not render optional description when omitted', () => {
    render(<EmptyState icon={Users} title="Sin clientes" />);
    expect(screen.queryByText('Agrega tu primer cliente.')).not.toBeInTheDocument();
  });
});

describe('SearchInput', () => {
  it('renders a text input and forwards value/onChange', () => {
    const onChange = vi.fn();
    render(<SearchInput placeholder="Buscar..." value="abc" onChange={onChange} />);

    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('placeholder', 'Buscar...');
    expect(input).toHaveValue('abc');

    fireEvent.change(input, { target: { value: 'def' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('forwards ref', () => {
    const ref = { current: null };
    render(<SearchInput ref={ref} />);
    expect(ref.current).not.toBeNull();
  });
});

describe('Th / Thead', () => {
  it('renders header cells inside a themed row', () => {
    render(
      <table>
        <Thead>
          <Th>Nombre</Th>
          <Th align="right">Total</Th>
        </Thead>
      </table>
    );

    expect(screen.getByText('Nombre')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Total').closest('th')).toHaveClass('text-right');
  });

  it('renders the dense variant of a cell', () => {
    render(
      <table>
        <Thead>
          <Th dense>Nombre</Th>
        </Thead>
      </table>
    );

    expect(screen.getByText('Nombre').closest('th')).toHaveClass('py-3');
  });
});