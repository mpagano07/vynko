import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ForecastPage from './page';
import { useAuth } from '@/lib/hooks/useAuth';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));
const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { getSession: getSessionMock } },
}));

vi.mock('recharts', async () => {
  const React = (await import('react')).default;
  const Stub = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  const Null = () => React.createElement('div', null);
  return {
    ResponsiveContainer: Stub,
    BarChart: Stub,
    Bar: Null,
    XAxis: Null,
    YAxis: Null,
    CartesianGrid: Null,
    Tooltip: Null,
  };
});

const authMock = vi.mocked(useAuth);

function mockAuth() {
  authMock.mockReturnValue({
    user: null,
    profile: null,
    tenant: { id: 't1', name: 'Central', slug: 'central', subscription_plan: 'business' },
    tenants: [{ id: 't1', name: 'Central', slug: 'central' }],
    role: 'owner',
    loading: false,
    logout: vi.fn(),
    isAuthenticated: true,
    allTenants: false,
    loadProfileAndTenant: vi.fn(),
    switchTenant: vi.fn(),
  });
}

const prediction = (overrides: Record<string, unknown>) => ({
  productId: 'p',
  productName: 'Producto',
  currentStock: 10,
  minStock: 2,
  avgDailySales: 0,
  projectedMonthlyDemand: 0,
  daysUntilStockout: null,
  needsReorder: false,
  suggestedOrder: 0,
  totalSoldLast30: 0,
  activeDays: 0,
  price: 100,
  cost: 50,
  ...overrides,
});

const a = prediction({
  productId: 'p1',
  productName: 'Top',
  currentStock: 2,
  minStock: 5,
  avgDailySales: 5,
  projectedMonthlyDemand: 150,
  daysUntilStockout: null,
  needsReorder: true,
  suggestedOrder: 298,
  totalSoldLast30: 150,
  activeDays: 30,
});

const b = prediction({
  productId: 'p2',
  productName: 'Medio',
  currentStock: 20,
  minStock: 5,
  avgDailySales: 0.5,
  projectedMonthlyDemand: 15,
  daysUntilStockout: 40,
  needsReorder: false,
  totalSoldLast30: 15,
  activeDays: 10,
});

const c = prediction({
  productId: 'p3',
  productName: 'Lento',
  currentStock: 1,
  minStock: 5,
  totalSoldLast30: 0,
  activeDays: 0,
});

const d = prediction({
  productId: 'p4',
  productName: 'Micro',
  currentStock: 5,
  minStock: 0,
  projectedMonthlyDemand: 1,
  totalSoldLast30: 1,
  activeDays: 1,
});

const payload = {
  predictions: [a, b, c, d],
  topProducts: [a, b],
  needsReorder: [a],
  summary: {
    totalSales30: 50000,
    totalTransactions30: 200,
    productsWithSales: 3,
    totalProducts: 4,
  },
  trends: null,
  aiAnalysis: null,
};

const fetchHandler = vi.fn();

function productsTable(): HTMLElement {
  const table = screen.getByText('Cobertura').closest('table');
  if (!table) throw new Error('Tabla de productos no encontrada');
  return table as HTMLElement;
}

describe('ForecastPage', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    fetchHandler.mockReset();
    fetchHandler.mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal('fetch', fetchHandler);
    mockAuth();
  });

  it('muestra "de X registrados" únicamente los productos que vendieron', async () => {
    render(<ForecastPage />);

    expect(await screen.findByText('de 4 registrados')).toBeInTheDocument();
    const kpi = screen.getByText('de 4 registrados').parentElement!.parentElement!;
    expect(within(kpi).getByText('3')).toBeInTheDocument();
  });

  it('marca como "Sin movimiento" solo a los que vendieron 0 y muestra "—"/"<0.1" en demanda', async () => {
    render(<ForecastPage />);
    await screen.findByText('de 4 registrados');

    const table = productsTable();

    const lentoRow = within(table).getByText('Lento').closest('tr')!;
    expect(within(lentoRow).getAllByText('—')).toHaveLength(2); // demanda y cobertura
    expect(within(lentoRow).getByText('Sin movimiento')).toBeInTheDocument();

    const microRow = within(table).getByText('Micro').closest('tr')!;
    expect(within(microRow).getByText('<0.1')).toBeInTheDocument();
    expect(within(microRow).queryByText('Sin movimiento')).not.toBeInTheDocument();
    expect(within(microRow).getByText('Saludable')).toBeInTheDocument();
  });

  it('muestra el conteo correcto de cada pestaña del filtro', async () => {
    render(<ForecastPage />);
    await screen.findByText('de 4 registrados');

    expect(screen.getByRole('button', { name: /Todos4/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /En riesgo1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alta demanda1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sin movimiento1/ })).toBeInTheDocument();
  });

  it('el filtro "Sin movimiento" lista solo productos con cero ventas', async () => {
    render(<ForecastPage />);
    await screen.findByText('de 4 registrados');

    fireEvent.click(screen.getByRole('button', { name: /Sin movimiento1/ }));

    const table = productsTable();
    await waitFor(() => expect(within(table).getByText('Lento')).toBeInTheDocument());
    expect(within(table).queryByText('Top')).not.toBeInTheDocument();
    expect(within(table).queryByText('Micro')).not.toBeInTheDocument();
  });

  it('"Alta demanda" y "Sin movimiento" no se solapan', async () => {
    render(<ForecastPage />);
    await screen.findByText('de 4 registrados');

    fireEvent.click(screen.getByRole('button', { name: /Alta demanda1/ }));

    const table = productsTable();
    await waitFor(() => expect(within(table).getByText('Top')).toBeInTheDocument());
    expect(within(table).queryByText('Lento')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Sin movimiento1/ }));

    await waitFor(() => expect(within(table).getByText('Lento')).toBeInTheDocument());
    expect(within(table).queryByText('Top')).not.toBeInTheDocument();
  });

  it('"En riesgo" excluye productos sin ventas aunque estén bajo el mínimo', async () => {
    render(<ForecastPage />);
    await screen.findByText('de 4 registrados');

    fireEvent.click(screen.getByRole('button', { name: /En riesgo1/ }));

    const table = productsTable();
    await waitFor(() => expect(within(table).getByText('Top')).toBeInTheDocument());
    // Lento está por debajo del mínimo (1 < 5) pero no vendió: no debe entrar en "En riesgo"
    expect(within(table).queryByText('Lento')).not.toBeInTheDocument();
  });
});
