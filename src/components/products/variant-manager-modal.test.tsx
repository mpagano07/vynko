import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { authFetch } from '@/lib/fetchWithTenant';
import type { Product } from '@/lib/types/product';
import type { ProductVariant } from '@/lib/types/variant';
import { VariantManagerModal } from './variant-manager-modal';

vi.mock('@/lib/fetchWithTenant', () => ({
  authFetch: vi.fn(async () => new Response('[]', { status: 200 })),
}));

const product: Product = {
  id: 'p-1',
  name: 'Remera',
  sku: 'REM-001',
  price: 25500,
  cost: 1500.5,
};

const variant: ProductVariant = {
  id: 'v-1',
  product_id: product.id,
  sku: 'REM-001-ROJO',
  barcode: null,
  label: 'Rojo',
  price: 15000,
  cost: 8000,
  active: true,
  stock: 90,
  deposito: 'Depósito norte',
  pasillo: 'B',
  estanteria: '3',
  valueIds: ['val-color-rojo'],
};

function renderModal(onChanged = vi.fn()) {
  return {
    onChanged,
    ...render(
      <VariantManagerModal
        product={product}
        categories={[]}
        onClose={vi.fn()}
        onChanged={onChanged}
      />,
    ),
  };
}

const attributes = [
  {
    id: 'attr-color',
    name: 'Color',
    values: [
      { id: 'val-color-rojo', value: 'Rojo' },
      { id: 'val-color-azul', value: 'Azul' },
    ],
  },
];

beforeEach(() => {
  vi.mocked(authFetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/attributes')) return new Response(JSON.stringify(attributes), { status: 200 });
    if (url.includes('/products/')) return new Response(JSON.stringify([variant]), { status: 200 });
    return new Response(JSON.stringify({ success: true, newStock: 45 }), { status: 200 });
  });
});

describe('VariantManagerModal · formato de moneda', () => {
  it('muestra costo y precio con el formato ARS de la plataforma', async () => {
    renderModal();

    await waitFor(() => expect(screen.getByLabelText('Precio ($)')).toBeInTheDocument());
    expect(screen.getByLabelText('Precio ($)')).toHaveValue('25.500');
    expect(screen.getByLabelText('Costo ($)')).toHaveValue('1.500,5');
  });

  it('agrupa miles y acepta coma decimal mientras se tipea', async () => {
    renderModal();

    await waitFor(() => expect(screen.getByLabelText('Precio ($)')).toBeInTheDocument());
    const price = screen.getByLabelText('Precio ($)');
    fireEvent.change(price, { target: { value: '80000' } });
    expect(price).toHaveValue('80.000');
    fireEvent.change(price, { target: { value: '80.000,50' } });
    expect(price).toHaveValue('80.000,50');
  });
});

describe('VariantManagerModal · stock y estado', () => {
  it('muestra el stock como solo valor, sin input, check ni botón Aplicar', async () => {
    renderModal();

    const row = (await screen.findByRole('button', { name: 'Editar Rojo' })).closest('tr');
    expect(row).toHaveTextContent('90');
    expect(row?.querySelector('input')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aplicar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Guardar stock/ })).not.toBeInTheDocument();
  });

  it('modifica el stock desde Editar enviando el valor final en el PATCH', async () => {
    const { onChanged } = renderModal();

    fireEvent.click(await screen.findByRole('button', { name: 'Editar Rojo' }));
    const stock = await screen.findByLabelText('Stock');
    expect(stock).toHaveValue(90);
    fireEvent.change(stock, { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(
      '/api/variants/v-1',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"stock":"45"'),
      }),
    ));
    expect(authFetch).not.toHaveBeenCalledWith('/api/variants/v-1/stock', expect.anything());
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(product.id));
  });

  it('muestra la ubicación guardada en la tabla del modal', async () => {
    renderModal();

    const row = (await screen.findByRole('button', { name: 'Editar Rojo' })).closest('tr');
    expect(row).toHaveTextContent('Depósito norte · B · 3');
  });

  it('elimina la variante desde la acción Eliminar, con confirmación', async () => {
    const { onChanged } = renderModal();

    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Rojo' }));
    expect(screen.getByText('Eliminar variante')).toBeInTheDocument();
    expect(authFetch).not.toHaveBeenCalledWith('/api/variants/v-1', { method: 'DELETE' });

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith('/api/variants/v-1', { method: 'DELETE' }));
    expect(authFetch).not.toHaveBeenCalledWith('/api/variants/v-1/active', expect.anything());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('refresca la tabla de productos al activar o desactivar una variante', async () => {
    const { onChanged } = renderModal();

    fireEvent.click(await screen.findByRole('button', { name: 'Activa' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(authFetch).toHaveBeenCalledWith(
      '/api/variants/v-1/active',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ active: false }) }),
    );
  });
});

describe('VariantManagerModal · etiqueta automática', () => {
  it('precarga la etiqueta a medida que se tildan valores de atributo', async () => {
    renderModal();

    await waitFor(() => expect(screen.getByLabelText('Etiqueta')).toBeInTheDocument());
    expect(screen.getByLabelText('Etiqueta')).toHaveValue('');

    fireEvent.click(await screen.findByLabelText('Rojo'));

    await waitFor(() => expect(screen.getByLabelText('Etiqueta')).toHaveValue('Color: Rojo'));
  });

  it('no sobrescribe una etiqueta escrita a mano', async () => {
    renderModal();

    const label = await screen.findByLabelText('Etiqueta');
    fireEvent.change(label, { target: { value: 'Rojo edición especial' } });
    fireEvent.click(await screen.findByLabelText('Azul'));

    expect(screen.getByLabelText('Etiqueta')).toHaveValue('Rojo edición especial');
  });
});
