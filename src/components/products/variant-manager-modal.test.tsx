import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Product } from '@/lib/types/product';
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

function renderModal() {
  return render(
    <VariantManagerModal
      product={product}
      categories={[]}
      onClose={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
}

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
