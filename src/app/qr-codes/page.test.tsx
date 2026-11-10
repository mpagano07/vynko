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

const product = (index: number) => ({
  id: `p-${index}`,
  name: `Producto ${String(index).padStart(2, '0')}`,
  barcode: `77${String(index).padStart(4, '0')}`,
  sku: null,
  category_id: null,
});

function renderPage(count: number) {
  authMock.mockReturnValue({
    tenant: { id: 't1', name: 'Central' },
    loading: false,
  } as unknown as ReturnType<typeof useAuth>);

  productsMock.mockReturnValue({
    products: Array.from({ length: count }, (_, i) => product(i + 1)),
    isLoading: false,
    isError: false,
    mutate: vi.fn(),
  } as unknown as ReturnType<typeof useProducts>);

  fetchWithTenantMock.mockResolvedValue({ ok: true, json: async () => [] });
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

    const openMock = vi
      .spyOn(window, 'open')
      .mockReturnValue({ focus: vi.fn(), document: { write: vi.fn(), close: vi.fn() }, print: vi.fn() } as unknown as Window);

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }));

    await waitFor(() => expect(toDataURLMock).toHaveBeenCalledTimes(20));
    await waitFor(() => expect(openMock).toHaveBeenCalled());
    // La ventana de impresión se abre sin referencia al opener.
    expect(openMock.mock.calls[0][2]).toContain('noopener');

    openMock.mockRestore();
  });
});
