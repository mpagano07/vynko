import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LossPreventionPage from './page';
import { useAuth } from '@/lib/hooks/useAuth';
import { useProducts } from '@/lib/hooks/useProducts';

const { replaceMock, authFetchMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  authFetchMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks/useProducts', () => ({ useProducts: vi.fn() }));

vi.mock('@/lib/fetchWithTenant', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

// El donut y las barras no aportan a estos tests y ResponsiveContainer necesita
// medir el DOM, cosa que jsdom no hace.
vi.mock('recharts', async () => {
  const React = (await import('react')).default;
  const Stub = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  return {
    ResponsiveContainer: Stub,
    PieChart: Stub,
    Pie: Stub,
    Cell: () => null,
    Tooltip: () => null,
  };
});

const authMock = vi.mocked(useAuth);
const productsMock = vi.mocked(useProducts);

const adjustment = (index: number) => ({
  id: `a-${index}`,
  quantity: -1,
  productId: 'p1',
  productName: `Ajuste ${String(index).padStart(2, '0')}`,
  reason: 'damaged',
  createdAt: '2026-11-01T12:00:00.000Z',
  createdBy: 'user-1',
});

function renderPage(count: number) {
  const items = Array.from({ length: count }, (_, i) => adjustment(i + 1));

  authMock.mockReturnValue({
    tenant: { id: 't1', name: 'Central', subscription_plan: 'business' },
    tenants: [{ id: 't1', name: 'Central' }],
    loading: false,
  } as unknown as ReturnType<typeof useAuth>);

  productsMock.mockReturnValue({
    products: [{ id: 'p1', name: 'Ajuste', cost: 0 }],
    isLoading: false,
  } as unknown as ReturnType<typeof useProducts>);

  authFetchMock.mockResolvedValue({ ok: true, json: async () => ({ items }) });

  render(<LossPreventionPage />);
}

/** Tabla del historial: es la única `<table>` de la página. */
function historyTable(): HTMLElement {
  return screen.getByRole('table');
}

/** Nombres de producto de las filas visibles, sin el header. */
function visibleProducts(): string[] {
  return within(historyTable())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[1].textContent?.trim() ?? '');
}

describe('historial de antipérdidas: paginación', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('corta el historial en páginas de 15 y muestra el rango', async () => {
    renderPage(20);

    await screen.findByRole('table');

    expect(visibleProducts()).toHaveLength(15);
    expect(screen.getByText(/Página/)).toHaveTextContent('Página 1 de 2');
    expect(screen.getByText('Mostrando 1–15 de 20 ajustes')).toBeInTheDocument();
  });

  it('pasa a la segunda página y lista lo que falta', async () => {
    renderPage(20);
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    await waitFor(() => expect(visibleProducts()).toHaveLength(5));
    expect(visibleProducts()[0]).toBe('Ajuste 16');
    expect(screen.getByText(/Página/)).toHaveTextContent('Página 2 de 2');
    expect(screen.getByText('Mostrando 16–20 de 20 ajustes')).toBeInTheDocument();
  });

  it('no muestra paginador si todo entra en una página', async () => {
    renderPage(4);
    await screen.findByRole('table');

    expect(visibleProducts()).toHaveLength(4);
    expect(screen.queryByText(/Página/)).not.toBeInTheDocument();
  });

  it('volver a la primera página al filtrar', async () => {
    renderPage(40);
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(screen.getByText(/Página/)).toHaveTextContent('Página 2 de 3'));

    const search = screen.getByPlaceholderText('Buscar por producto...');
    fireEvent.change(search, { target: { value: 'Ajuste 2' } });
    expect(screen.queryByText(/Página/)).not.toBeInTheDocument();

    // Al limpiar el filtro hay que quedar en la página 1, no volver a la 2.
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText(/Página/)).toHaveTextContent('Página 1 de 3');
    expect(visibleProducts()[0]).toBe('Ajuste 01');
  });
});
