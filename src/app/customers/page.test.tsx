import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CustomersPage from './page';

const { authFetchMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
}));

vi.mock('@/lib/fetchWithTenant', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

vi.mock('@/lib/hooks/useExport', () => ({
  useExport: () => ({ exporting: false, busy: false, run: vi.fn() }),
}));

const customer = (index: number) => ({
  id: `c-${index}`,
  name: `Cliente ${String(index).padStart(2, '0')}`,
  email: null,
  phone: null,
  address: null,
  cuit: null,
});

function renderPage(count: number) {
  authFetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/customers') {
      return { ok: true, json: async () => Array.from({ length: count }, (_, i) => customer(i + 1)) };
    }
    return { ok: true, json: async () => [] };
  });

  render(<CustomersPage />);
}

/** Nombres de las filas visibles, sin el header. */
function visibleNames(): string[] {
  return within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent?.trim() ?? '');
}

describe('clientes: paginación', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('corta la tabla en páginas de 15 y muestra el rango', async () => {
    renderPage(20);

    await screen.findByRole('table');

    expect(visibleNames()).toHaveLength(15);
    expect(screen.getByText(/Página/)).toHaveTextContent('Página 1 de 2');
    expect(screen.getByText('Mostrando 1–15 de 20 clientes')).toBeInTheDocument();
  });

  it('pasa a la segunda página y lista lo que falta', async () => {
    renderPage(20);
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    await waitFor(() => expect(visibleNames()).toHaveLength(5));
    expect(visibleNames()[0]).toBe('Cliente 16');
    expect(screen.getByText(/Página/)).toHaveTextContent('Página 2 de 2');
    expect(screen.getByText('Mostrando 16–20 de 20 clientes')).toBeInTheDocument();
  });

  it('no muestra paginador si todo entra en una página', async () => {
    renderPage(4);
    await screen.findByRole('table');

    expect(visibleNames()).toHaveLength(4);
    expect(screen.queryByText(/Página/)).not.toBeInTheDocument();
  });

  it('vuelve a la primera página al buscar', async () => {
    renderPage(40);
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(screen.getByText(/Página/)).toHaveTextContent('Página 2 de 3'));

    const search = screen.getByPlaceholderText('Buscar por nombre, CUIT, documento, email o teléfono...');
    fireEvent.change(search, { target: { value: 'Cliente 2' } });
    // Los resultados del filtro entran en una página.
    expect(screen.queryByText(/Página/)).not.toBeInTheDocument();

    // Al limpiar el filtro hay que quedar en la página 1, no volver a la 2.
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText(/Página/)).toHaveTextContent('Página 1 de 3');
    expect(visibleNames()[0]).toBe('Cliente 01');
  });
});
