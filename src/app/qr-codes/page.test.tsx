import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ImgHTMLAttributes, ReactNode } from 'react';
import CodigosPage from './page';
import { useAuth } from '@/lib/hooks/useAuth';
import { useProducts } from '@/lib/hooks/useProducts';

const { fetchWithTenantMock, toDataURLMock } = vi.hoisted(() => ({
  fetchWithTenantMock: vi.fn(),
  toDataURLMock: vi.fn(),
}));

vi.mock('next/image', () => ({
  // Stub mínimo: sólo importa que el <img> exista con el QR de la tarjeta.
  default: ({ src, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string; children?: ReactNode }) => (
    // eslint-disable-next-line @next/next/no-img-element -- mock del componente Image
    <img src={src} alt={alt} {...rest} />
  ),
}));

vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks/useProducts', () => ({ useProducts: vi.fn() }));

vi.mock('@/lib/fetchWithTenant', () => ({
  fetchWithTenant: (...args: unknown[]) => fetchWithTenantMock(...args),
}));

// El QR se importa dinámicamente desde la página; el mock cubre ese import.
vi.mock('qrcode', () => ({
  toDataURL: (code: string) => toDataURLMock(code),
}));

const authMock = vi.mocked(useAuth);
const productsMock = vi.mocked(useProducts);

const product = (index: number, overrides: Record<string, unknown> = {}) => ({
  id: `p-${index}`,
  name: `Producto ${String(index).padStart(2, '0')}`,
  barcode: `77${String(index).padStart(4, '0')}`,
  sku: null,
  category_id: null,
  price: 1500,
  ...overrides,
});

function renderPage(count: number, options: { categories?: Array<{ id: string; name: string }>; isError?: boolean } = {}) {
  authMock.mockReturnValue({
    tenant: { id: 't1', name: 'Central' },
    loading: false,
  } as unknown as ReturnType<typeof useAuth>);

  productsMock.mockReturnValue({
    products: Array.from({ length: count }, (_, i) => product(i + 1, i === 0 ? { category_id: 'cat-1' } : {})),
    isLoading: false,
    isError: options.isError ?? false,
    mutate: vi.fn(),
  } as unknown as ReturnType<typeof useProducts>);

  fetchWithTenantMock.mockImplementation(async (url: string) => {
    if (url === '/api/categories') {
      return { ok: true, json: async () => options.categories ?? [] };
    }
    return { ok: true, json: async () => [] };
  });
  toDataURLMock.mockImplementation(async (code: string) => `data:image/png;base64,${code}`);

  render(<CodigosPage />);
}

describe('códigos QR: generación perezosa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('genera sólo los QR de la página visible, no todo el catálogo', async () => {
    renderPage(20);

    await screen.findByText('Producto 01');

    expect(toDataURLMock).toHaveBeenCalledTimes(15);
    expect(screen.getByText(/Página/)).toHaveTextContent('Página 1 de 2');
    // El primer producto de la página 2 no se generó al montar.
    expect(toDataURLMock).not.toHaveBeenCalledWith('770016');
  });

  it('al cambiar de página genera sólo los QR de esa página', async () => {
    renderPage(20);

    await screen.findByText('Producto 01');
    await waitFor(() => expect(toDataURLMock).toHaveBeenCalledTimes(15));

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    await screen.findByText('Producto 16');
    await waitFor(() => expect(toDataURLMock).toHaveBeenCalledTimes(20));
  });

  it('no muestra paginador si todo entra en una página', async () => {
    renderPage(10);

    await screen.findByText('Producto 01');

    expect(screen.queryByText(/Página/)).not.toBeInTheDocument();
    expect(toDataURLMock).toHaveBeenCalledTimes(10);
  });

  it('imprimir completa los QR que faltan de todos los filtrados', async () => {
    renderPage(20);

    await screen.findByText('Producto 01');
    await waitFor(() => expect(toDataURLMock).toHaveBeenCalledTimes(15));

    const printWindow = {
      focus: vi.fn(),
      print: vi.fn(),
      addEventListener: vi.fn(),
      document: { write: vi.fn(), close: vi.fn() },
    };
    const openMock = vi
      .spyOn(window, 'open')
      .mockReturnValue(printWindow as unknown as Window);

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }));

    await waitFor(() => expect(toDataURLMock).toHaveBeenCalledTimes(20));
    await waitFor(() => expect(openMock).toHaveBeenCalled());
    // Sin `noopener`: con esa feature window.open() devuelve null y la ventana
    // quedaba en blanco. El vínculo se corta después con `opener = null`.
    expect(openMock.mock.calls[0][2]).not.toContain('noopener');
    expect(printWindow.document.write).toHaveBeenCalled();
    // Y la impresión se dispara desde la ventana padre tras el delay.
    await waitFor(() => expect(printWindow.print).toHaveBeenCalled(), { timeout: 2000 });

    openMock.mockRestore();
  });

  it('filtra por categoría con el select y por texto con la búsqueda', async () => {
    renderPage(20, { categories: [{ id: 'cat-1', name: 'Redes' }] });

    await screen.findByText('Producto 01');

    // El select de categorías carga las opciones del tenant.
    fireEvent.click(screen.getByRole('button', { name: /todas las categorías/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Redes' }));

    expect(screen.getByText('1 producto(s)')).toBeInTheDocument();
    expect(screen.getByText('Producto 01')).toBeInTheDocument();
    expect(screen.queryByText('Producto 02')).not.toBeInTheDocument();

    // La búsqueda también filtra; al limpiarla la categoría sigue activa
    // (los filtros componen), así que vuelve al único producto de Redes.
    const search = screen.getByPlaceholderText('Buscar por nombre, SKU o código...');
    fireEvent.change(search, { target: { value: 'Producto 02' } });
    expect(screen.getByText('Sin productos')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText(/producto\(s\)/)).toHaveTextContent('1 producto(s)');
  });

  it('con error de carga ofrece reintentar y llama a mutate', async () => {
    const mutate = vi.fn();
    authMock.mockReturnValue({
      tenant: { id: 't1', name: 'Central' },
      loading: false,
    } as unknown as ReturnType<typeof useAuth>);
    productsMock.mockReturnValue({
      products: [],
      isLoading: false,
      isError: true,
      mutate,
    } as unknown as ReturnType<typeof useProducts>);
    fetchWithTenantMock.mockResolvedValue({ ok: true, json: async () => [] });

    render(<CodigosPage />);

    const retry = await screen.findByRole('button', { name: 'Reintentar' });
    expect(screen.getByText('No se pudieron cargar los productos')).toBeInTheDocument();

    fireEvent.click(retry);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('refleja los toggles de categoría, nombre, precio y SKU en las tarjetas de ejemplo', async () => {
    renderPage(1, { categories: [{ id: 'cat-1', name: 'Redes' }] });

    await screen.findByText('Producto 01');
    expect(screen.getByText('Redes')).toBeInTheDocument();
    expect(screen.getByText(/1\.500,00/)).toBeInTheDocument();
    expect(screen.getByText('770001')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Categoría'));
    fireEvent.click(screen.getByLabelText('Nombre'));
    fireEvent.click(screen.getByLabelText('Precio'));
    fireEvent.click(screen.getByLabelText('SKU'));

    expect(screen.queryByText('Redes')).not.toBeInTheDocument();
    expect(screen.queryByText('Producto 01')).not.toBeInTheDocument();
    expect(screen.queryByText(/1\.500,00/)).not.toBeInTheDocument();
    expect(screen.queryByText('770001')).not.toBeInTheDocument();
    // La tarjeta sigue mostrando el QR y su botón de descarga.
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeInTheDocument();
  });

  it('abre una vista ampliada del QR al tocar la tarjeta', async () => {
    renderPage(1);

    await screen.findByText('Producto 01');
    await waitFor(() => expect(toDataURLMock).toHaveBeenCalledTimes(1));

    // El botón sólo tiene nombre accesible cuando el QR ya está generado.
    const trigger = await screen.findByRole('button', { name: 'Ampliar QR de Producto 01' });
    fireEvent.click(trigger);

    expect(await screen.findByRole('dialog', { name: 'QR de Producto 01' })).toBeInTheDocument();
    expect(screen.getByText('Apuntá la cámara al código para escanearlo.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('descarga el QR de un producto como archivo', async () => {
    renderPage(1);

    await screen.findByText('Producto 01');
    await waitFor(() => expect(toDataURLMock).toHaveBeenCalledTimes(1));

    // El handler asigna el data URL directo al anchor (sin createObjectURL).
    let href = '';
    let download = '';
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        href = this.href;
        download = this.download;
      });

    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }));

    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(href).toMatch(/^data:image\/png;base64,/);
    expect(download).toBe('770001.png');

    anchorClick.mockRestore();
  });
});
