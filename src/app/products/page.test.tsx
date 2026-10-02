import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProductsPage from './page';
import { useAuth } from '@/lib/hooks/useAuth';
import { useProducts } from '@/lib/hooks/useProducts';
import { useCategories } from '@/lib/hooks/useCategories';
import type { Product } from '@/lib/types/product';

const { searchParamsMock, replaceMock } = vi.hoisted(() => ({
  searchParamsMock: { get: vi.fn(() => null) },
  replaceMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  useSearchParams: () => searchParamsMock,
}));

vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks/useProducts', () => ({ useProducts: vi.fn() }));
vi.mock('@/lib/hooks/useCategories', () => ({ useCategories: vi.fn() }));

vi.mock('@/lib/hooks/useExport', () => ({
  useExport: () => ({ exporting: false, busy: false, run: vi.fn() }),
}));

vi.mock('@/lib/fetchWithTenant', () => ({
  getTenantHeaders: vi.fn(() => ({})),
  authFetch: vi.fn(async () => ({ ok: true })),
}));

// El TransferInbox hace fetch por su cuenta y no aporta a estos tests.
vi.mock('@/components/transfers/TransferInbox', () => ({
  TransferInbox: () => null,
}));

const authMock = vi.mocked(useAuth);
const productsMock = vi.mocked(useProducts);
const categoriesMock = vi.mocked(useCategories);

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: 'TV 100 Pulgadas',
  category_id: 'c1',
  price: 80000,
  cost: 204626,
  stock: 12,
  min_stock: 5,
  max_stock: 50,
  is_active: true,
  ...overrides,
});

function renderPage(items: Product[] = [product()]) {
  productsMock.mockReturnValue({
    products: items,
    isLoading: false,
    isError: false,
    mutate: vi.fn(),
  } as unknown as ReturnType<typeof useProducts>);

  render(<ProductsPage />);
}

/** Abre el modal de edición del producto indicado y devuelve sus inputs de monto. */
async function openEditModal(name = 'TV 100 Pulgadas') {
  fireEvent.click(await screen.findByRole('button', { name: `Editar ${name}` }));
  const price = await screen.findByLabelText('Precio ($)');
  return { price, cost: screen.getByLabelText('Costo ($)') };
}

describe('modal de producto: montos con separador de miles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock.get.mockReturnValue(null);
    authMock.mockReturnValue({
      tenant: { id: 't1', name: 'Central' },
      tenants: [{ id: 't1', name: 'Central' }],
    } as unknown as ReturnType<typeof useAuth>);
    categoriesMock.mockReturnValue({
      categories: [{ id: 'c1', name: 'Tv' }],
      mutate: vi.fn(),
    } as unknown as ReturnType<typeof useCategories>);
    window.history.replaceState({}, '', '/products');
  });

  it('abre el modal con el precio y el costo ya agrupados', async () => {
    renderPage();
    const { price, cost } = await openEditModal();

    expect(price).toHaveValue('80.000');
    expect(cost).toHaveValue('204.626');
  });

  it('agrupa los miles a medida que se tipea', async () => {
    renderPage();
    const { price } = await openEditModal();

    fireEvent.change(price, { target: { value: '80000' } });
    expect(price).toHaveValue('80.000');

    fireEvent.change(price, { target: { value: '1234567' } });
    expect(price).toHaveValue('1.234.567');
  });

  it('respeta los decimales con coma', async () => {
    renderPage();
    const { price } = await openEditModal();

    fireEvent.change(price, { target: { value: '1234,5' } });
    expect(price).toHaveValue('1.234,5');
  });

  it('el margen usa el número parseado, no el texto con puntos', async () => {
    renderPage();
    const { price } = await openEditModal();

    fireEvent.change(price, { target: { value: '80000' } });

    // (80000 - 204626) / 204626 = -60.9% -> "-61%"
    expect(screen.getByDisplayValue('-61%')).toBeInTheDocument();
  });

  it('deja el campo vacío en vez de mostrar un 0 al borrarlo', async () => {
    renderPage();
    const { price } = await openEditModal();

    fireEvent.change(price, { target: { value: '' } });
    expect(price).toHaveValue('');
  });

  it('normaliza un valor pegado que ya viene con separadores', async () => {
    renderPage();
    const { price } = await openEditModal();

    // Los puntos se descartan y se vuelven a agregar, así que el resultado es el mismo.
    fireEvent.change(price, { target: { value: '80.000' } });
    expect(price).toHaveValue('80.000');
  });

  it('descarta letras que se cuelan en el campo', async () => {
    renderPage();
    const { price } = await openEditModal();

    fireEvent.change(price, { target: { value: 'abc' } });
    expect(price).toHaveValue('');
  });

  it('el deep-link ?edit=<id> abre el modal del producto', async () => {
    window.history.replaceState({}, '', '/products?edit=p1');
    renderPage();

    expect(await screen.findByLabelText('Precio ($)')).toHaveValue('80.000');
  });

  it('no arrastra el borrador al abrir otro producto', async () => {
    renderPage([
      product({ id: 'p1', name: 'TV 100 Pulgadas', price: 80000 }),
      product({ id: 'p2', name: 'Horno Atma', price: 5000 }),
    ]);

    const first = await openEditModal('TV 100 Pulgadas');
    fireEvent.change(first.price, { target: { value: '999999' } });
    expect(first.price).toHaveValue('999.999');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    const second = await openEditModal('Horno Atma');

    await waitFor(() => expect(second.price).toHaveValue('5.000'));
  });
});