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
    ResponsiveContainer: ({
      children,
      initialDimension,
    }: {
      children?: React.ReactNode;
      initialDimension?: { width: number; height: number };
    }) => React.createElement('div', {
      'data-initial-width': initialDimension?.width,
      'data-initial-height': initialDimension?.height,
    }, children),
    BarChart: Stub,
    Bar: Null,
    XAxis: Null,
    YAxis: Null,
    CartesianGrid: Null,
    Tooltip: Null,
    Cell: Null,
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
    noTenantAccess: false,
    loadProfileAndTenant: vi.fn(),
    switchTenant: vi.fn(),
    setActiveTenant: vi.fn(),
    refreshSession: vi.fn(async () => true),
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
  suggestedOrder15: 0,
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
  daysUntilStockout: 1,
  needsReorder: true,
  suggestedOrder: 298,
  suggestedOrder15: 73,
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
  upcomingStockout: [
    { productId: 'p1', productName: 'Top', currentStock: 2, daysUntilStockout: 1 },
    { productId: 'p2', productName: 'Medio', currentStock: 20, daysUntilStockout: 10 },
  ],
  summary: {
    totalSales30: 50000,
    totalTransactions30: 200,
    productsWithSales: 3,
    totalProducts: 4,
    needsReorderCount: 1,
    stockoutRiskCount: 1,
    deadStockCount: 1,
    immobilizedCapital: 50,
    purchaseSuggestion15: 3650,
    stockEffectivenessPct: 75,
  },
  trends: null,
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

  it('muestra las métricas de acción: sugerencia de compra, quiebre, capital y efectividad', async () => {
    render(<ForecastPage />);
    await screen.findByText('Efectividad del stock');

    // Efectividad del stock: "3" y "de 4" son nodos de texto separados por el span
    expect(screen.getByText('de 4')).toBeInTheDocument();

    // Próximo a agotarse: panel con 2 productos
    const panel = screen.getByText('Próximo a agotarse').closest('div') as HTMLElement;
    expect(within(panel).getByText('Top')).toBeInTheDocument();
    expect(within(panel).getByText('Medio')).toBeInTheDocument();
    expect(within(panel).getByText(/— quedan 2 u/)).toBeInTheDocument();
    expect(within(panel).getByText(/— quedan 20 u/)).toBeInTheDocument();
  });

  it('inicializa el gráfico con dimensiones válidas', async () => {
    render(<ForecastPage />);
    await screen.findByText('Efectividad del stock');

    const chart = document.querySelector('[data-initial-width="100"]');
    expect(chart).toHaveAttribute('data-initial-height', '160');
  });

  it('marca como "Sin movimiento" solo a los que vendieron 0 y muestra "—"/"<0.1" en demanda', async () => {
    render(<ForecastPage />);
    await screen.findByText('Efectividad del stock');

    fireEvent.click(screen.getByRole('button', { name: /Todos4/ }));

    const table = productsTable();

    const lentoRow = within(table).getByText('Lento').closest('tr')!;
    expect(within(lentoRow).getAllByText('—')).toHaveLength(4); // demanda, cobertura, cantidad a pedir y acción
    expect(within(lentoRow).getByText('Sin movimiento')).toBeInTheDocument();

    const microRow = within(table).getByText('Micro').closest('tr')!;
    expect(within(microRow).getByText('<0.1')).toBeInTheDocument();
    expect(within(microRow).queryByText('Sin movimiento')).not.toBeInTheDocument();
    expect(within(microRow).getByText('Saludable')).toBeInTheDocument();
  });

  it('muestra el conteo correcto de cada pestaña del filtro', async () => {
    render(<ForecastPage />);
    await screen.findByText('Efectividad del stock');

    expect(screen.getByRole('button', { name: /Todos4/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /En riesgo1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alta demanda1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sin movimiento1/ })).toBeInTheDocument();
  });

  it('el filtro "Sin movimiento" lista solo productos con cero ventas', async () => {
    render(<ForecastPage />);
    await screen.findByText('Efectividad del stock');

    fireEvent.click(screen.getByRole('button', { name: /Sin movimiento1/ }));

    const table = productsTable();
    await waitFor(() => expect(within(table).getByText('Lento')).toBeInTheDocument());
    expect(within(table).queryByText('Top')).not.toBeInTheDocument();
    expect(within(table).queryByText('Micro')).not.toBeInTheDocument();
  });

  it('"Alta demanda" y "Sin movimiento" no se solapan', async () => {
    render(<ForecastPage />);
    await screen.findByText('Efectividad del stock');

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
    await screen.findByText('Efectividad del stock');

    fireEvent.click(screen.getByRole('button', { name: /En riesgo1/ }));

    const table = productsTable();
    await waitFor(() => expect(within(table).getByText('Top')).toBeInTheDocument());
    // Lento está por debajo del mínimo (1 < 5) pero no vendió: no debe entrar en "En riesgo"
    expect(within(table).queryByText('Lento')).not.toBeInTheDocument();
  });

  it('muestra la columna "Cantidad a pedir" y el botón "Crear orden" para productos con sugerencia', async () => {
    render(<ForecastPage />);
    await screen.findByText('Efectividad del stock');

    // Tab "En riesgo" muestra Top que tiene suggestedOrder15=73
    const table = productsTable();
    expect(within(table).getByText('73 u.')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: /Crear orden/ })).toHaveAttribute(
      'href',
      '/providers?create_po=1&productId=p1&qty=73',
    );
  });

  it('"Próximo a agotarse" pinta en rojo solo lo urgente (<= 7 días)', async () => {
    render(<ForecastPage />);
    await screen.findByText('Efectividad del stock');

    const panel = screen.getByText('Próximo a agotarse').closest('div') as HTMLElement;
    expect(within(panel).getByText('1 días').className).toContain('text-rose-600');
    expect(within(panel).getByText('10 días').className).toContain('text-amber-600');
  });

  describe('productos que se venden bajo su costo', () => {
    // Ojo: la pagina cae en "Sin datos suficientes" si ningun producto vendio
    // (forecast/page.tsx:144), asi que los mocks necesitan totalSoldLast30 > 0.
    function mockWithPredictions(predictions: Record<string, unknown>[]) {
      fetchHandler.mockResolvedValue({
        ok: true,
        json: async () => ({ ...payload, predictions }),
      });
    }

    function lossTable(): HTMLElement {
      const el = screen.getByText('Pierde por unidad').closest('table');
      if (!el) throw new Error('Tabla de pérdidas no encontrada');
      return el as HTMLElement;
    }

    function lossRows(): string[] {
      return within(lossTable())
        .getAllByRole('row')
        .slice(1) // el primero es el header
        .map((r) => within(r).getAllByRole('cell')[0].textContent ?? '');
    }

    it('con el catálogo sano no renderiza la sección de pérdidas', async () => {
      render(<ForecastPage />);
      await screen.findByText('Efectividad del stock');

      // En el payload base todos venden con precio 100 y costo 50.
      // Que nadie venda bajo el costo es lo normal: no merece ocupar espacio.
      expect(screen.queryByText('Se venden bajo su costo')).not.toBeInTheDocument();
      expect(screen.queryByText('Pierde por unidad')).not.toBeInTheDocument();
      expect(screen.queryByTestId('loss-summary')).not.toBeInTheDocument();
    });

    it('lista los que venden bajo costo con la pérdida por unidad y el margen', async () => {
      mockWithPredictions([
        prediction({
          productId: 'p-perdida',
          productName: 'TV 100',
          price: 150,
          cost: 204626,
          totalSoldLast30: 6,
        }),
      ]);
      render(<ForecastPage />);
      await screen.findByText('Efectividad del stock');

      const row = within(lossTable()).getByText('TV 100').closest('tr')!;
      expect(within(row).getByText('$ 204.626,00')).toBeInTheDocument(); // costo
      expect(within(row).getByText('$ 150,00')).toBeInTheDocument(); // precio
      expect(within(row).getByText('−$ 204.476,00')).toBeInTheDocument(); // pierde por unidad
      expect(within(row).getByText('-100%')).toBeInTheDocument(); // margen
    });

    it('el link "Corregir" abre el producto con ?edit=<id>', async () => {
      mockWithPredictions([
        prediction({
          productId: 'p-perdida',
          productName: 'TV 100',
          price: 150,
          cost: 204626,
          totalSoldLast30: 6,
        }),
      ]);
      render(<ForecastPage />);
      await screen.findByText('Efectividad del stock');

      expect(within(lossTable()).getByRole('link', { name: /Corregir/ })).toHaveAttribute(
        'href',
        '/products?edit=p-perdida'
      );
    });

    it('ordena de mayor a menor pérdida por unidad', async () => {
      mockWithPredictions([
        prediction({ productId: 'p1', productName: 'Leve', price: 90, cost: 100, totalSoldLast30: 1 }),
        prediction({ productId: 'p2', productName: 'Grave', price: 10, cost: 1000, totalSoldLast30: 1 }),
        prediction({ productId: 'p3', productName: 'Medio', price: 50, cost: 200, totalSoldLast30: 1 }),
      ]);
      render(<ForecastPage />);
      await screen.findByText('Efectividad del stock');

      expect(lossRows()).toEqual(['Grave', 'Medio', 'Leve']);
    });

    it('trata "sin costo cargado" como dato faltante y no como pérdida', async () => {
      // El forecast service mapea cost con `Number(product.cost) || 0`, asi que 0
      // significa "no cargado". Con costo 0 el producto queda fuera igual porque
      // price < 0 es imposible; la guarda `cost > 0` es defensiva.
      mockWithPredictions([
        prediction({ productId: 'p1', productName: 'Sin costo', price: 100, cost: 0, totalSoldLast30: 1 }),
        prediction({ productId: 'p2', productName: 'Precio 0', price: 0, cost: 500, totalSoldLast30: 1 }),
      ]);
      render(<ForecastPage />);
      await screen.findByText('Efectividad del stock');

      // Solo "Precio 0": costo 500 contra precio 0 es una perdida real.
      expect(lossRows()).toEqual(['Precio 0']);
      expect(within(lossTable()).queryByText('Sin costo')).not.toBeInTheDocument();
    });

    it('estima la pérdida de los últimos 30 días multiplicando por unidades vendidas', async () => {
      mockWithPredictions([
        prediction({
          productId: 'p1',
          productName: 'TV 100',
          price: 150,
          cost: 200,
          totalSoldLast30: 6,
        }),
      ]);
      render(<ForecastPage />);
      await screen.findByText('Efectividad del stock');

      // (200 - 150) * 6 = $ 300
      const desc = screen.getByTestId('loss-summary');
      // formatARS separa los miles con espacio duro, asi que \s y no un espacio fijo.
      expect(desc.textContent).toMatch(/\$\s300,00/);
      expect(desc.textContent).toContain('pérdida');
    });
  });
});
