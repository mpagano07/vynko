import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Users } from 'lucide-react';
import { LoadingState } from './loading-state';
import { EmptyState } from './empty-state';
import { SearchInput } from './search-input';
import { Thead, Th } from './table-header';
import { FormLabel } from './form-label';
import { StatusBadge } from './status-badge';
import { PageHeader } from './page-header';
import { IconAction } from './icon-action';
import { StatCard } from './stat-card';

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

describe('FormLabel', () => {
  it('renders the default uppercase variant', () => {
    render(<FormLabel htmlFor="email">Email</FormLabel>);

    const label = screen.getByText('Email');
    expect(label).toHaveClass('text-xs', 'font-semibold', 'text-gray-500');
  });

  it('renders the default (non-uppercase) variant', () => {
    render(<FormLabel variant="default">Nombre</FormLabel>);

    const label = screen.getByText('Nombre');
    expect(label).toHaveClass('text-sm', 'font-medium', 'text-gray-700');
  });

  it('forwards htmlFor and merges className overrides', () => {
    render(
      <FormLabel htmlFor="product-name" className="text-[10px]">
        Nombre
      </FormLabel>
    );

    const label = screen.getByText('Nombre');
    expect(label).toHaveAttribute('for', 'product-name');
    expect(label).toHaveClass('text-[10px]');
  });
});

describe('StatusBadge', () => {
  it('renders children with the default gray / sm styles', () => {
    render(<StatusBadge>Pendiente</StatusBadge>);

    const badge = screen.getByText('Pendiente');
    expect(badge).toHaveClass('inline-flex', 'rounded-full', 'bg-gray-100', 'px-2', 'py-0.5');
  });

  it('applies the requested tone and size', () => {
    render(
      <StatusBadge tone="emerald" size="md">
        Recibida
      </StatusBadge>
    );

    const badge = screen.getByText('Recibida');
    expect(badge).toHaveClass('bg-emerald-100', 'text-emerald-700', 'px-2.5', 'py-1', 'text-xs', 'font-semibold');
  });

  it('renders an icon and merges className overrides', () => {
    render(
      <StatusBadge tone="rose" icon={<Users className="h-3 w-3" />} className="font-bold capitalize">
        Crítico
      </StatusBadge>
    );

    const badge = screen.getByText('Crítico');
    expect(badge.querySelector('svg')).toBeInTheDocument();
    expect(badge).toHaveClass('bg-rose-50', 'text-rose-600', 'font-bold', 'capitalize');
  });
});

describe('PageHeader', () => {
  it('renders title, subtitle and icon', () => {
    render(
      <PageHeader
        icon={<Users className="h-8 w-8" />}
        title="Clientes"
        subtitle="Gestiona tus clientes."
      />
    );

    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(screen.getByText('Gestiona tus clientes.')).toBeInTheDocument();
    expect(screen.getByText('Clientes').querySelector('svg')).toBeInTheDocument();
  });

  it('applies the responsive container by default and compact variant', () => {
    const { container } = render(<PageHeader title="Header" />);
    expect(container.querySelector('header')).toHaveClass('sm:justify-between', 'gap-4');

    const { container: compactContainer } = render(<PageHeader title="Header" compact />);
    expect(compactContainer.querySelector('header')).toHaveClass('justify-between');
    expect(compactContainer.querySelector('header')).not.toHaveClass('gap-4');
  });

  it('renders actions on the right and merges subtitle className', () => {
    render(
      <PageHeader
        title="Antipérdidas"
        subtitle="Control de mermas."
        subtitleClassName="text-gray-500"
        actions={<button>Reportar</button>}
      />
    );

    expect(screen.getByRole('button', { name: 'Reportar' })).toBeInTheDocument();
    expect(screen.getByText('Control de mermas.')).toHaveClass('text-gray-500');
  });

  it('renders extra children below the subtitle', () => {
    render(
      <PageHeader title="Registrar Venta">
        <span>Atajo F2</span>
      </PageHeader>
    );

    expect(screen.getByText('Atajo F2')).toBeInTheDocument();
  });
});

describe('IconAction', () => {
  it('renders an icon button with the given accessible label', () => {
    render(<IconAction icon={Users} label="Editar cliente" onClick={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Editar cliente' });
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('applies tone and size classes', () => {
    render(<IconAction icon={Users} label="Eliminar" tone="danger" />);

    const button = screen.getByRole('button', { name: 'Eliminar' });
    expect(button).toHaveClass('p-1.5', 'text-red-500');
  });

  it('merges className overrides onto the base', () => {
    render(<IconAction icon={Users} label="Actualizar" className="rounded-full" />);

    const button = screen.getByRole('button', { name: 'Actualizar' });
    expect(button).toHaveClass('rounded-full');
    expect(button).toHaveAttribute('type', 'button');
  });
});

describe('StatCard', () => {
  it('renders title, value and subtitle', () => {
    render(<StatCard title="Balance neto" value="+5 u." subtitle="2 recuperadas · 1 perdidas" />);

    expect(screen.getByText('Balance neto')).toBeInTheDocument();
    expect(screen.getByText('+5 u.')).toBeInTheDocument();
    expect(screen.getByText('2 recuperadas · 1 perdidas')).toBeInTheDocument();
  });

  it('renders an icon chip with the tone classes', () => {
    const { container } = render(<StatCard title="Riesgo" value="3" icon={Users} tone="rose" />);

    const chip = container.querySelector('svg')?.parentElement;
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveClass('bg-rose-50');
  });

  it('renders the trend pill with sign and arrow for positive values', () => {
    render(<StatCard title="Ingresos" value="$100" trend={12.5} />);

    expect(screen.getByText('+12.5%')).toBeInTheDocument();
  });

  it('renders the horizontal layout with icon on the left', () => {
    render(<StatCard horizontal title="Total pagos" value={7} icon={Users} tone="green" />);

    const card = screen.getByText('Total pagos').closest('.flex');
    expect(card).toHaveClass('items-center');
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows a skeleton while loading and hides the value', () => {
    const { container } = render(<StatCard title="Ventas" value="$10" loading />);

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('$10')).not.toBeInTheDocument();
  });
});