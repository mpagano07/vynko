'use client';

import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormLabel } from '@/components/ui/form-label';
import { ShortLabel } from '@/components/ui/short-label';
import { formatARS, groupThousands, parseAmountInput, amountToInput } from '@/lib/utils/currency';
import { marginPercent, parseMarginInput, priceFromMargin } from '@/lib/product-margin';
import type { Product } from '@/lib/types/product';
import type { Category } from '@/lib/types/category';

export interface ProductFormValues {
  name: string;
  category_id: string;
  sku: string;
  barcode: string;
  price: number;
  cost: number;
  stock: number;
  min_stock: number;
  max_stock: number;
  deposito: string;
  pasillo: string;
  estanteria: string;
  description: string;
  image_url: string;
  image_storage_path: string;
}

export interface ProductFormModalProps {
  /** Producto en edición, o `null` cuando se crea uno nuevo. */
  editingProduct: Product | null;
  productForm: ProductFormValues;
  setProductForm: Dispatch<SetStateAction<ProductFormValues>>;
  categories: Category[];
  isSubmitting: boolean;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}

/**
 * Modal de alta/edición de producto.
 *
 * Se monta sólo mientras está abierto (`products/page.tsx` lo renderiza bajo
 * `isProductModalOpen`), así que los borradores de precio/costo/margen se
 * reinician solos al cerrar y no hace falta limpiarlos desde la página.
 */
export function ProductFormModal({
  editingProduct,
  productForm,
  setProductForm,
  categories,
  isSubmitting,
  onSubmit,
  onClose,
}: ProductFormModalProps) {
  // Los inputs de precio y costo muestran los miles separados ("80.000"), así
  // que necesitan un borrador de texto: `type="number"` no acepta separadores.
  const [amountDraft, setAmountDraft] = useState<{ price?: string; cost?: string }>({});
  const [marginDraft, setMarginDraft] = useState<string | null>(null);

  const priceDisplay = amountDraft.price ?? amountToInput(productForm.price);
  const costDisplay = amountDraft.cost ?? amountToInput(productForm.cost);
  const marginDisplay =
    marginDraft !== null
      ? marginDraft
      : productForm.cost > 0 && productForm.price > 0
        ? `${marginPercent(productForm.price, productForm.cost) >= 0 ? '+' : ''}${marginPercent(productForm.price, productForm.cost).toFixed(0)}%`
        : '';

  const handleAmountChange = (field: 'price' | 'cost') => (raw: string) => {
    const formatted = groupThousands(raw);
    const parsedValue = parseAmountInput(formatted);
    setAmountDraft((prev) => ({ ...prev, [field]: formatted }));

    if (field === 'price') {
      setMarginDraft(null);
      setProductForm((prev) => ({ ...prev, price: parsedValue }));
      return;
    }

    // Si el usuario fijó un margen a mano, al cambiar el costo se recalcula el
    // precio con ese margen en vez de dejarlo desactualizado. El cálculo va
    // fuera del updater de `setProductForm` para no encadenar un setState
    // dentro del render de otro componente.
    const margin = marginDraft !== null ? parseMarginInput(marginDraft) : null;
    const calculatedPrice = margin !== null && parsedValue > 0 ? priceFromMargin(parsedValue, margin) : null;

    setProductForm((prev) => ({
      ...prev,
      cost: parsedValue,
      ...(calculatedPrice !== null ? { price: calculatedPrice } : {}),
    }));

    if (calculatedPrice !== null) {
      setAmountDraft((prev) => ({ ...prev, price: amountToInput(calculatedPrice) }));
    }
  };

  const handleMarginChange = (raw: string) => {
    setMarginDraft(raw);
    const margin = parseMarginInput(raw);
    if (margin !== null && productForm.cost > 0) {
      const calculatedPrice = priceFromMargin(productForm.cost, margin);
      setProductForm((prev) => ({ ...prev, price: calculatedPrice }));
      setAmountDraft((prev) => ({ ...prev, price: amountToInput(calculatedPrice) }));
    }
  };

  return (
    <Modal
      aria-label="Producto"
      onClose={onClose}
      className="max-w-2xl flex flex-col max-h-[90vh]"
      title={editingProduct ? 'Editar Producto' : 'Agregar Nuevo Producto'}
    >
      <form onSubmit={onSubmit} className="space-y-4 overflow-y-auto pr-1 flex-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <FormLabel htmlFor="product-name">Nombre del Producto *</FormLabel>
            <Input
              id="product-name"
              name="name"
              type="text"
              required
              placeholder="Ej. Coca Cola 1.5L"
              value={productForm.name}
              onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
            />
          </div>

          <div>
            <FormLabel htmlFor="product-category">Categoría</FormLabel>
            <Select
              id="product-category"
              name="categoria"
              value={productForm.category_id}
              onChange={(e) => setProductForm({ ...productForm, category_id: e.target.value })}
            >
              <option value="">Seleccionar categoría...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:col-span-2">
            <div>
              <FormLabel htmlFor="product-barcode">Código de Barras / GTIN</FormLabel>
              <Input
                id="product-barcode"
                name="barcode"
                type="text"
                placeholder="Ej. 7791234567890"
                value={productForm.barcode}
                onChange={(e) => setProductForm({ ...productForm, barcode: e.target.value })}
              />
            </div>
            <div>
              <FormLabel htmlFor="product-sku">SKU</FormLabel>
              <Input
                id="product-sku"
                name="sku"
                type="text"
                placeholder="Ej. REF-COCA-1.5"
                value={productForm.sku}
                onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:col-span-2">
            <div>
              <FormLabel htmlFor="product-cost">Costo ($)</FormLabel>
              <Input
                id="product-cost"
                name="cost"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                className="tabular-nums"
                value={costDisplay}
                onChange={(e) => handleAmountChange('cost')(e.target.value)}
              />
            </div>
            <div>
              <FormLabel htmlFor="product-price">Precio ($)</FormLabel>
              <Input
                id="product-price"
                name="price"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                required
                placeholder="0,00"
                className="tabular-nums"
                value={priceDisplay}
                onChange={(e) => handleAmountChange('price')(e.target.value)}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <FormLabel htmlFor="product-margin">Margen (%)</FormLabel>
                {productForm.cost > 0 && productForm.price > 0 && (
                  <span
                    className={`text-xs font-semibold ${
                      productForm.price >= productForm.cost
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {productForm.price >= productForm.cost
                      ? `+${formatARS(productForm.price - productForm.cost)}`
                      : formatARS(productForm.price - productForm.cost)}
                  </span>
                )}
              </div>
              <div className="relative">
                <Input
                  id="product-margin"
                  name="margin"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="Ej. 40"
                  className="tabular-nums pr-7 font-medium"
                  value={marginDisplay}
                  onChange={(e) => handleMarginChange(e.target.value)}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 dark:text-gray-500 pointer-events-none">
                  %
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:col-span-2">
            <div>
              <FormLabel htmlFor="product-stock" className="text-xs">
                Stock Inicial
              </FormLabel>
              <Input
                id="product-stock"
                name="stock"
                type="number"
                value={productForm.stock}
                onChange={(e) => setProductForm({ ...productForm, stock: Number(e.target.value) })}
              />
            </div>
            <div>
              <FormLabel htmlFor="product-min-stock" className="text-xs">
                Mínimo Crítico
              </FormLabel>
              <Input
                id="product-min-stock"
                name="min_stock"
                type="number"
                value={productForm.min_stock}
                onChange={(e) => setProductForm({ ...productForm, min_stock: Number(e.target.value) })}
              />
            </div>
            <div>
              <FormLabel htmlFor="product-max-stock" className="text-xs">
                Máximo Sugerido
              </FormLabel>
              <Input
                id="product-max-stock"
                name="max_stock"
                type="number"
                value={productForm.max_stock}
                onChange={(e) => setProductForm({ ...productForm, max_stock: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <FormLabel>Ubicación en depósito</FormLabel>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <FormLabel htmlFor="product-deposito" className="text-xs">
                  Depósito
                </FormLabel>
                <Input
                  id="product-deposito"
                  name="deposito"
                  type="text"
                  placeholder="Ej. A"
                  value={productForm.deposito}
                  onChange={(e) => setProductForm({ ...productForm, deposito: e.target.value })}
                />
              </div>
              <div>
                <FormLabel htmlFor="product-pasillo" className="text-xs">
                  Pasillo
                </FormLabel>
                <Input
                  id="product-pasillo"
                  name="pasillo"
                  type="text"
                  placeholder="Ej. 3"
                  value={productForm.pasillo}
                  onChange={(e) => setProductForm({ ...productForm, pasillo: e.target.value })}
                />
              </div>
              <div>
                <FormLabel htmlFor="product-estanteria" className="text-xs">
                  Estantería
                </FormLabel>
                <Input
                  id="product-estanteria"
                  name="estanteria"
                  type="text"
                  placeholder="Ej. 2"
                  value={productForm.estanteria}
                  onChange={(e) => setProductForm({ ...productForm, estanteria: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="sm:col-span-2">
            <FormLabel htmlFor="product-description">Descripción del producto</FormLabel>
            <textarea
              id="product-description"
              name="description"
              className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              rows={3}
              placeholder="Detalles del producto, empaque, etc."
              value={productForm.description}
              onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Guardando...
              </>
            ) : (
              <ShortLabel short="Guardar">Guardar Cambios</ShortLabel>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
