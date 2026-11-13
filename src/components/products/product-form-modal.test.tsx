import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProductFormModal, type ProductFormValues } from './product-form-modal';

const baseForm: ProductFormValues = {
  name: '',
  category_id: '',
  sku: '',
  barcode: '',
  price: 0,
  cost: 0,
  stock: 0,
  min_stock: 5,
  max_stock: 100,
  deposito: '',
  pasillo: '',
  estanteria: '',
  description: '',
  image_url: '',
  image_storage_path: '',
};

function Harness({
  onSubmit = vi.fn(),
  onClose = vi.fn(),
}: {
  onSubmit?: (event: React.FormEvent) => void;
  onClose?: () => void;
}) {
  const [form, setForm] = useState<ProductFormValues>({ ...baseForm });
  return (
    <ProductFormModal
      editingProduct={null}
      productForm={form}
      setProductForm={setForm}
      categories={[]}
      isSubmitting={false}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  );
}

describe('ProductFormModal', () => {
  it('calcula el precio al tipear un margen sobre el costo', () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText('Costo ($)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Margen (%)'), { target: { value: '40' } });

    expect(screen.getByLabelText('Precio ($)')).toHaveValue('140');
  });

  it('recalcula el precio si cambia el costo con un margen fijado', () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText('Costo ($)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Margen (%)'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Costo ($)'), { target: { value: '200' } });

    expect(screen.getByLabelText('Precio ($)')).toHaveValue('300');
  });

  it('vuelve al modo precio cuando el usuario edita el precio a mano', () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText('Costo ($)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Margen (%)'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Precio ($)'), { target: { value: '130' } });

    // El margen escrito se descarta y se muestra el que sale del precio nuevo.
    expect(screen.getByLabelText('Margen (%)')).toHaveValue('+30%');
  });

  it('envía el formulario y permite cancelar', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onClose = vi.fn();
    render(<Harness onSubmit={onSubmit} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Nombre del Producto *'), { target: { value: 'Coca' } });
    fireEvent.change(screen.getByLabelText('Precio ($)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(onSubmit).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
