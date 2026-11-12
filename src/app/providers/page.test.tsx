import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProvidersPage from './page';
import { useAuth } from '@/lib/hooks/useAuth';
import type { Supplier } from '@/lib/types/supplier';

const { pushMock, authFetchMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  authFetchMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: vi.fn() }));

vi.mock('@/lib/fetchWithTenant', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

vi.mock('@/lib/hooks/useExport', () => ({
  useExport: () => ({ exporting: false, busy: false, run: vi.fn() }),
}));

const authMock = vi.mocked(useAuth);

const supplier = (index: number): Supplier => ({
  id: `s-${index}`,
  tenant_id: 't1',
  name: `Proveedor ${String(index).padStart(2, '0')}`,
});

function renderPage(count: number) {
  authMock.mockReturnValue({
    tenant: { id: 't1', name: 'Central' },
    allTenants: false,
    loading: false,
  } as unknown as ReturnType<typeof useAuth>);

  authFetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/suppliers') {
      return { ok: true, json: async () => Array.from({ length: count }, (_, i) => supplier(i + 1)) };
    }
    if (url === '/api/products') {
      return { ok: true, json: async () => [{ id: 'p1', name: 'Producto Uno', cost: 100, is_active: true }] };
    }
    return { ok: true, json: async () => [] };
  });

  render(<ProvidersPage />);
}

/** Nombres de las filas visibles, sin el header. */
function visibleNames(): string[] {
  return within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent?.trim() ?? '');
}

describe('proveedores: paginación', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('corta la tabla en páginas de 15 y muestra el rango', async () => {
    renderPage(20);

    await screen.findByRole('table');

    expect(visibleNames()).toHaveLength(15);
    expect(screen.getByText(/Página/)).toHaveTextContent('Página 1 de 2');
    expect(screen.getByText('Mostrando 1–15 de 20 proveedores')).toBeInTheDocument();
  });

  it('pasa a la segunda página y lista lo que falta', async () => {
    renderPage(20);
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    await waitFor(() => expect(visibleNames()).toHaveLength(5));
    expect(visibleNames()[0]).toBe('Proveedor 16');
    expect(screen.getByText(/Página/)).toHaveTextContent('Página 2 de 2');
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

    const search = screen.getByPlaceholderText('Buscar proveedor por nombre, CUIT, contacto o email...');
    fireEvent.change(search, { target: { value: 'Proveedor 3' } });
    expect(screen.queryByText(/Página/)).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText(/Página/)).toHaveTextContent('Página 1 de 3');
    expect(visibleNames()[0]).toBe('Proveedor 01');
  });
});

describe('proveedores: pedidos de compra unificados', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no baja el catálogo de productos al montar la página', async () => {
    renderPage(3);

    await screen.findByRole('table');

    expect(authFetchMock).toHaveBeenCalledWith('/api/suppliers');
    expect(authFetchMock).not.toHaveBeenCalledWith('/api/products');
  });

  it('deriva la creación de pedidos al módulo de compras', async () => {
    renderPage(3);
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: /nuevo pedido/i }));

    expect(pushMock).toHaveBeenCalledWith('/documents?type=orden_compra&create_po=1');
  });
});
