import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProductsPage from './page';
import { useAuth } from '@/lib/hooks/useAuth';
import { useProducts } from '@/lib/hooks/useProducts';
import { useCategories } from '@/lib/hooks/useCategories';
import { authFetch } from '@/lib/fetchWithTenant';
import type { Product } from '@/lib/types/product';
import { rememberDriveIntent, takeDriveIntent } from '@/lib/google/drive-intent';

const { searchParamsMock, replaceMock } = vi.hoisted(() => ({
  searchParamsMock: { get: vi.fn((_key: string): string | null => null) },
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
const authFetchMock = vi.mocked(authFetch);

/** Respuesta mínima de fetch para los mocks de `authFetch`: jsdom no arma el
 *  `Response` completo, y el código bajo test sólo lee `ok`/`status`/`json`. */
const jsonResponse = (body: unknown, status = 200): Response =>
  ({ ok: true, status, json: async () => body } as unknown as Response);

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

  it('permite tipear el margen deseado y calcula el precio de venta automáticamente', async () => {
    renderPage([product({ cost: 1000, price: 1000 })]);
    await openEditModal();
    const marginInput = screen.getByLabelText(/margen/i);
    expect(marginInput).toBeInTheDocument();

    // Setea margen al 50%: precio debe calcular a 1.500
    fireEvent.change(marginInput, { target: { value: '50' } });
    expect(screen.getByLabelText('Precio ($)')).toHaveValue('1.500');
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

  it('el deep-link ?import=1 abre el modal de importación del checklist', async () => {
    searchParamsMock.get.mockImplementation((key) => (key === 'import' ? '1' : null));
    renderPage();

    expect(await screen.findByText('Importar productos desde Excel o CSV')).toBeInTheDocument();
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

describe('retomar el flujo de Google Drive al volver del OAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock.get.mockReturnValue(null);
    window.sessionStorage.clear();
    authMock.mockReturnValue({
      tenant: { id: 't1', name: 'Central' },
      tenants: [{ id: 't1', name: 'Central' }],
    } as unknown as ReturnType<typeof useAuth>);
    categoriesMock.mockReturnValue({
      categories: [{ id: 'c1', name: 'Tv' }],
      mutate: vi.fn(),
    } as unknown as ReturnType<typeof useCategories>);
  });

  it('reabre el export con la plataforma y el formato que habían elegido', async () => {
    window.history.replaceState({}, '', '/products?drive_connected=true');
    rememberDriveIntent({ kind: 'export', platform: 'tiendanube', format: 'csv' });

    renderPage();

    expect(await screen.findByLabelText('Exportar productos')).toBeInTheDocument();
    expect(screen.getByText(/encabezados que acepta la importación de productos de tiendanube/i)).toBeInTheDocument();
    // La intención se consume: recargar no debe volver a exportar.
    expect(takeDriveIntent()).toBeNull();
  });

  it('no retoma nada si el usuario conectó Drive desde otra pantalla', async () => {
    window.history.replaceState({}, '', '/products?drive_connected=true');

    renderPage();

    expect((await screen.findAllByText('TV 100 Pulgadas')).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Exportar productos')).not.toBeInTheDocument();
  });

  it('retoma el export aunque la página se remonte al resolver la sucursal', async () => {
    // Reproduce lo que hace `ClientLayoutWrapper`: mientras la sesión carga, la
    // página se monta con una key provisoria y al resolverse la sucursal se
    // remonta con otra. Si el flag de OAuth se consume en el primer montaje, la
    // acción se pierde.
    window.history.replaceState({}, '', '/products?drive_connected=true');
    rememberDriveIntent({ kind: 'export', platform: 'tiendanube', format: 'csv' });

    productsMock.mockReturnValue({
      products: [product()],
      isLoading: false,
      isError: false,
      mutate: vi.fn(),
    } as unknown as ReturnType<typeof useProducts>);

    authMock.mockReturnValue({
      tenant: null,
      tenants: [],
      loading: true,
    } as unknown as ReturnType<typeof useAuth>);

    const { rerender } = render(
      <div key="none">
        <ProductsPage />
      </div>
    );

    authMock.mockReturnValue({
      tenant: { id: 't1', name: 'Central' },
      tenants: [{ id: 't1', name: 'Central' }],
      loading: false,
    } as unknown as ReturnType<typeof useAuth>);

    rerender(
      <div key="t1">
        <ProductsPage />
      </div>
    );

    expect(await screen.findByLabelText('Exportar productos')).toBeInTheDocument();
  });

  it('no reanuda si el OAuth terminó con error', async () => {
    window.history.replaceState({}, '', '/products?drive_error=cancelled');
    rememberDriveIntent({ kind: 'import' });

    renderPage();

    expect((await screen.findAllByText('TV 100 Pulgadas')).length).toBeGreaterThan(0);
    // Se descarta la intención para que no se reanude en una próxima visita.
    expect(takeDriveIntent()).toBeNull();
  });
});

describe('modal de nueva transferencia', () => {
  const BRANCHES = [
    { id: 't1', name: 'Central' },
    { id: 't2', name: 'Norte' },
  ];

  const renderMultiBranch = (
    items: Product[],
    authOverrides: Record<string, unknown> = {}
  ) => {
    productsMock.mockReturnValue({
      products: items,
      isLoading: false,
      isError: false,
      mutate: vi.fn(),
    } as unknown as ReturnType<typeof useProducts>);
    categoriesMock.mockReturnValue({
      categories: [{ id: 'c1', name: 'Tv' }],
      mutate: vi.fn(),
    } as unknown as ReturnType<typeof useCategories>);
    authMock.mockReturnValue({
      tenant: { id: 't1', name: 'Central' },
      tenants: BRANCHES,
      allTenants: false,
      loading: false,
      ...authOverrides,
    } as unknown as ReturnType<typeof useAuth>);
    render(<ProductsPage />);
  };

  /** Abre Gestionar → Transferencias y devuelve el input de búsqueda del modal. */
  const openTransferModal = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /gestionar/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Transferencias' }));
    return screen.findByPlaceholderText(/buscar productos/i);
  };

  /** Elige una opción del `Select` custom (botón + listbox) por su etiqueta. */
  const pickSelectOption = (triggerName: string | RegExp, optionName: string) => {
    fireEvent.click(screen.getByRole('button', { name: triggerName }));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: optionName }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock.get.mockReturnValue(null);
    window.history.replaceState({}, '', '/products');
    // Default inofensivo: los tests que necesitan datos lo pisan.
    authFetchMock.mockImplementation(async () => jsonResponse({}));
  });

  it('busca en el catálogo en memoria de la sucursal activa, sin bajar nada', async () => {
    renderMultiBranch([
      product({ id: 'p1', name: 'Café La Morenita', sku: 'CAFE-1' }),
      product({ id: 'p2', name: 'Yerba Playadito', barcode: '7791234567890' }),
    ]);
    const search = await openTransferModal();

    // Sin acento matchea el nombre con acento, como el buscador de la tabla.
    fireEvent.change(search, { target: { value: 'cafe' } });
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('button', { name: /café la morenita/i })).toBeInTheDocument();

    // También por código de barras.
    fireEvent.change(search, { target: { value: '7791' } });
    expect(await within(dialog).findByRole('button', { name: /yerba playadito/i })).toBeInTheDocument();

    // El catálogo de la sucursal activa ya está en la página: no se re-baja.
    expect(
      authFetchMock.mock.calls.filter(([url]) => String(url).includes('/api/products'))
    ).toHaveLength(0);
  });

  it('baja el catálogo slim cuando el origen es otra sucursal', async () => {
    authFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/products/slim') {
        return jsonResponse([{ id: 'p9', name: 'Termo Lumilagro', sku: 'TERMO-9', barcode: null }]);
      }
      return jsonResponse({});
    });
    renderMultiBranch([product({ id: 'p1', name: 'TV 100 Pulgadas' })]);
    await openTransferModal();

    pickSelectOption('Central', 'Norte');

    await waitFor(() =>
      expect(authFetchMock).toHaveBeenCalledWith('/api/products/slim', {
        headers: { 'x-active-tenant-id': 't2' },
      })
    );

    const search = screen.getByPlaceholderText(/buscar productos/i);
    await waitFor(() => expect(search).not.toBeDisabled());
    fireEvent.change(search, { target: { value: 'termo' } });
    expect(await screen.findByRole('button', { name: /termo lumilagro/i })).toBeInTheDocument();
    // Nunca pidió el catálogo completo: sólo la versión slim.
    expect(authFetchMock.mock.calls.some(([url]) => String(url) === '/api/products')).toBe(false);
  });

  it('en el consolidado no reusa la unión de sucursales: pide el slim del origen', async () => {
    renderMultiBranch([product()], { tenant: null, allTenants: true });
    await openTransferModal();

    pickSelectOption('Seleccionar origen...', 'Central');

    await waitFor(() =>
      expect(authFetchMock).toHaveBeenCalledWith('/api/products/slim', {
        headers: { 'x-active-tenant-id': 't1' },
      })
    );
  });

  it('crea la transferencia con origen, destino e items', async () => {
    authFetchMock.mockImplementation(async () => jsonResponse({ id: 'tr-1' }, 201));
    renderMultiBranch([product({ id: 'p1', name: 'TV 100 Pulgadas' })]);
    await openTransferModal();

    pickSelectOption('Seleccionar destino...', 'Norte');

    const search = screen.getByPlaceholderText(/buscar productos/i);
    fireEvent.change(search, { target: { value: 'tv' } });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: /tv 100 pulgadas/i }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar transferencia' }));

    await waitFor(() =>
      expect(authFetchMock).toHaveBeenCalledWith('/api/stock-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_tenant_id: 't1',
          to_tenant_id: 't2',
          items: [{ product_id: 'p1', quantity: 1 }],
        }),
      })
    );

    // onSuccess cierra el modal.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Enviar transferencia' })).not.toBeInTheDocument()
    );
  });
});