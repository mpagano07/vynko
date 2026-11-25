'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormLabel } from '@/components/ui/form-label';
import { IconAction } from '@/components/ui/icon-action';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { amountToInput, formatARS, groupThousands, parseAmountInput } from '@/lib/utils/currency';
import { marginPercent } from '@/lib/product-margin';
import { authFetch } from '@/lib/fetchWithTenant';
import type { Category } from '@/lib/types/category';
import type { ProductAttribute, ProductVariant } from '@/lib/types/variant';
import type { Product } from '@/lib/types/product';
import { Layers3, Plus, Edit, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface Props {
  product: Product;
  categories: Category[];
  onClose: () => void;
  onChanged: () => void;
}

/**
 * El formulario de alta arranca con los valores visibles del producto principal
 * para que la variante se lea como parte del mismo producto. Son defaults
 * editables: SKU, código, costo, precio y stock quedan bajo control de la
 * variante en cuanto se guarda.
 */
export const formFromProduct = (product: Product) => ({
  label: '',
  sku: product.sku ?? '',
  barcode: product.barcode ?? '',
  price: String(product.price ?? 0),
  cost: product.cost == null ? '' : String(product.cost),
  stock: String(product.stock ?? 0),
  min_stock: String(product.min_stock ?? 0),
  max_stock: String(product.max_stock ?? 0),
  deposito: product.deposito ?? '',
  pasillo: product.pasillo ?? '',
  estanteria: product.estanteria ?? '',
  category_id: product.category_id ?? '',
});

export function VariantManagerModal({ product, categories, onClose, onChanged }: Props) {
  const [attributes, setAttributes] = useState<ProductAttribute[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => formFromProduct(product));
  // Costo y precio se muestran con el formato de moneda de la plataforma
  // ("80.000,50"): `form` conserva el número crudo para la API y este borrador
  // conserva lo que el usuario está tipeando, igual que en ProductFormModal.
  const [amountDraft, setAmountDraft] = useState<{ price?: string; cost?: string }>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [variantToDelete, setVariantToDelete] = useState<ProductVariant | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [newAttribute, setNewAttribute] = useState('');
  const [newAttributeValues, setNewAttributeValues] = useState('');
  const [valueInputs, setValueInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [attrRes, variantRes] = await Promise.all([
      authFetch('/api/variants/attributes'),
      authFetch(`/api/variants/products/${encodeURIComponent(product.id)}`),
    ]);
    if (attrRes.ok) setAttributes(await attrRes.json());
    if (variantRes.ok) setVariants(await variantRes.json());
    setLoading(false);
  }, [product.id]);

  useEffect(() => {
    // Carga inicial del modal: es el único momento en que el fetch define el
    // estado (igual que el resto de las pantallas con `fetchX` + useEffect).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const autoLabel = useMemo(() => {
    const chosen = attributes
      .flatMap((a) => (a.values ?? []).filter((v) => selectedValues.includes(v.id)).map((v) => `${a.name}: ${v.value}`));
    return chosen.join(' · ');
  }, [attributes, selectedValues]);

  const priceDisplay = amountDraft.price ?? amountToInput(Number(form.price));
  const costDisplay = amountDraft.cost ?? amountToInput(Number(form.cost));

  const handleAmountChange = (field: 'price' | 'cost') => (raw: string) => {
    const formatted = groupThousands(raw);
    setAmountDraft((prev) => ({ ...prev, [field]: formatted }));
    setForm((prev) => ({
      ...prev,
      // Costo vacío significa "sin costo" (null en la API); precio vacío es 0.
      [field]: formatted === '' && field === 'cost' ? '' : String(parseAmountInput(formatted)),
    }));
  };

  const resetForm = () => {
    setForm(formFromProduct(product));
    setAmountDraft({});
    setEditingId(null);
    setSelectedValues([]);
  };

  const toggleValue = (id: string) => {
    setSelectedValues((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]);
  };

  const handleSaveVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedValues.length === 0) {
      toast.error('Elegí al menos un valor de atributo para la variante');
      return;
    }
    // Los defaults vienen del padre, pero sus códigos quedan reservados:
    // dejar el mismo valor sería ambiguo para el escáner y para el POS.
    if (!editingId) {
      const parentSku = (product.sku ?? '').trim();
      const parentBarcode = (product.barcode ?? '').trim();
      if (parentSku && form.sku.trim() === parentSku) {
        toast.error('El SKU del producto principal es reservado: cargá un SKU propio para la variante');
        return;
      }
      if (parentBarcode && form.barcode.trim() === parentBarcode) {
        toast.error('El código de barras del producto principal es reservado: cargá uno propio para la variante');
        return;
      }
    }
    setSaving(true);
    try {
      const body = {
        ...form,
        label: form.label.trim() || autoLabel,
        valueIds: selectedValues,
        cost: form.cost === '' ? null : Number(form.cost),
        price: Number(form.price),
      };
      const res = editingId
        ? await authFetch(`/api/variants/${editingId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
        : await authFetch(`/api/variants/products/${encodeURIComponent(product.id)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar la variante');
      toast.success(editingId ? 'Variante actualizada' : 'Variante creada');
      resetForm();
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar la variante');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (variant: ProductVariant) => {
    setEditingId(variant.id);
    setAmountDraft({});
    setForm({
      label: variant.label,
      sku: variant.sku ?? '',
      barcode: variant.barcode ?? '',
      price: String(variant.price ?? 0),
      cost: variant.cost == null ? '' : String(variant.cost),
      stock: String(variant.stock ?? 0),
      min_stock: String(variant.min_stock ?? 0),
      max_stock: String(variant.max_stock ?? 0),
      deposito: variant.deposito ?? '',
      pasillo: variant.pasillo ?? '',
      estanteria: variant.estanteria ?? '',
      category_id: variant.category_id ?? '',
    });
    setSelectedValues(variant.valueIds ?? []);
  };

  const handleToggleActive = async (variant: ProductVariant) => {
    const res = await authFetch(`/api/variants/${variant.id}/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !variant.active }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'No se pudo cambiar el estado');
      return;
    }
    toast.success(variant.active ? 'Variante desactivada' : 'Variante activada');
    await load();
    onChanged();
  };

  const handleDeleteVariant = async () => {
    if (!variantToDelete) return;
    setDeleting(true);
    try {
      const res = await authFetch(`/api/variants/${variantToDelete.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo eliminar la variante');
      toast.success(`Variante ${variantToDelete.label} eliminada`);
      setVariantToDelete(null);
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar la variante');
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateAttribute = async (e: React.FormEvent) => {
    e.preventDefault();
    const values = newAttributeValues.split(',').map((v) => v.trim()).filter(Boolean);
    if (!newAttribute.trim() || values.length === 0) {
      toast.error('Ingresá el nombre y al menos un valor');
      return;
    }
    const res = await authFetch('/api/variants/attributes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newAttribute.trim(), values }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'No se pudo crear el atributo');
      return;
    }
    setNewAttribute('');
    setNewAttributeValues('');
    await load();
  };

  const handleAddValue = async (attributeId: string) => {
    const value = (valueInputs[attributeId] ?? '').trim();
    if (!value) return;
    const res = await authFetch(`/api/variants/attributes/${attributeId}/values`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || 'No se pudo agregar el valor');
      return;
    }
    setValueInputs((prev) => ({ ...prev, [attributeId]: '' }));
    await load();
  };

  return (
    <>
    <Modal
      onClose={onClose}
      className="max-w-5xl"
      header={<span className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2"><Layers3 className="h-5 w-5 text-indigo-600" /> Variantes de {product.name}</span>}
    >
      <div className="p-4 space-y-5 max-h-[80vh] overflow-y-auto">
        {loading ? (
          <p className="text-sm text-gray-500">Cargando variantes…</p>
        ) : (
          <>
            <section>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">1. Atributos y valores</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {attributes.map((attribute) => (
                  <div key={attribute.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{attribute.name}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {(attribute.values ?? []).map((value) => (
                        <label key={value.id} className="inline-flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            checked={selectedValues.includes(value.id)}
                            onChange={() => toggleValue(value.id)}
                          />
                          {value.value}
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Input
                        value={valueInputs[attribute.id] ?? ''}
                        onChange={(e) => setValueInputs((prev) => ({ ...prev, [attribute.id]: e.target.value }))}
                        placeholder="Nuevo valor"
                        className="h-8 text-xs"
                      />
                      <Button type="button" variant="outline" size="sm" onClick={() => void handleAddValue(attribute.id)}>Agregar</Button>
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={handleCreateAttribute} className="flex flex-wrap items-end gap-2 mt-3">
                <div className="flex-1 min-w-[160px]">
                  <FormLabel>Nuevo atributo</FormLabel>
                  <Input value={newAttribute} onChange={(e) => setNewAttribute(e.target.value)} placeholder="Ej: Color" />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <FormLabel>Valores (separados por coma)</FormLabel>
                  <Input value={newAttributeValues} onChange={(e) => setNewAttributeValues(e.target.value)} placeholder="Rojo, Azul, Negro" />
                </div>
                <Button type="submit" variant="outline"><Plus className="h-4 w-4" /> Crear atributo</Button>
              </form>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
                2. Variantes creadas manualmente <span className="text-gray-400">({variants.length})</span>
              </h3>
              {variants.length === 0 ? (
                <p className="text-sm text-gray-500">Todavía no hay variantes. Configurá los valores y creá la primera abajo.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 uppercase">
                      <tr>
                        <th className="px-2 py-2">Variante</th>
                        <th className="px-2 py-2">SKU / Barcode</th>
                        <th className="px-2 py-2 text-right">Costo</th>
                        <th className="px-2 py-2 text-right">Precio</th>
                        <th className="px-2 py-2 text-right">Stock</th>
                        <th className="px-2 py-2">Estado</th>
                        <th className="px-2 py-2 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {variants.map((variant) => (
                        <tr key={variant.id}>
                          <td className="px-2 py-2 font-medium text-gray-900 dark:text-gray-100">{variant.label}</td>
                          <td className="px-2 py-2 font-mono text-gray-500">{variant.sku || '—'}{variant.barcode ? ` · ${variant.barcode}` : ''}</td>
                          <td className="px-2 py-2 text-right">{formatARS(variant.cost ?? 0)}</td>
                          <td className="px-2 py-2 text-right font-semibold text-green-600 dark:text-green-400">
                            {formatARS(variant.price)}
                            {variant.cost != null && variant.cost > 0 && (
                              <span className="block text-[10px] text-gray-500">
                                Margen: {marginPercent(variant.price, variant.cost).toFixed(0)}%
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums">{variant.stock ?? 0}</td>
                          <td className="px-2 py-2">
                            <button type="button" onClick={() => void handleToggleActive(variant)} className="text-xs text-indigo-600 dark:text-indigo-400 underline">
                              {variant.active ? 'Activa' : 'Inactiva'}
                            </button>
                          </td>
                          <td className="px-2 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <IconAction icon={Edit} label={`Editar ${variant.label}`} tone="indigo" onClick={() => handleEdit(variant)} />
                              <IconAction
                                icon={Trash2}
                                label={`Eliminar ${variant.label}`}
                                tone="red"
                                onClick={() => setVariantToDelete(variant)}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <form onSubmit={handleSaveVariant} className="rounded-lg border border-indigo-100 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/20 p-3 space-y-3">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                3. {editingId ? 'Editar variante' : 'Nueva variante'} (creación manual, sin combinaciones automáticas)
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {editingId
                  ? 'Los valores son propios de esta variante.'
                  : `Valores iniciales tomados de ${product.name}. Ajustá SKU, código, costo, precio y stock: son propios de cada variante y el SKU/código del producto principal está reservado.`}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <FormLabel>Etiqueta</FormLabel>
                  <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={autoLabel || 'Ej: Rojo / Talle M'} />
                </div>
                <div>
                  <FormLabel>SKU</FormLabel>
                  <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Opcional" />
                </div>
                <div>
                  <FormLabel>Código de barras</FormLabel>
                  <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Opcional" />
                </div>
                <div>
                  <FormLabel>Categoría</FormLabel>
                  <select
                    value={form.category_id}
                    onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-2 text-sm"
                  >
                    <option value="">Sin categoría</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <FormLabel htmlFor="variant-cost">Costo ($)</FormLabel>
                  <Input
                    id="variant-cost"
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
                  <FormLabel htmlFor="variant-price">Precio ($)</FormLabel>
                  <Input
                    id="variant-price"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0,00"
                    className="tabular-nums"
                    value={priceDisplay}
                    onChange={(e) => handleAmountChange('price')(e.target.value)}
                  />
                </div>
                <div>
                  <FormLabel htmlFor="variant-stock">{editingId ? 'Stock' : 'Stock inicial'}</FormLabel>
                  <Input
                    id="variant-stock"
                    type="number"
                    min={0}
                    step={1}
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  />
                </div>
                <div><FormLabel>Stock mínimo</FormLabel><Input type="number" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} /></div>
                <div><FormLabel>Stock máximo</FormLabel><Input type="number" value={form.max_stock} onChange={(e) => setForm({ ...form, max_stock: e.target.value })} /></div>
                <div><FormLabel>Depósito</FormLabel><Input value={form.deposito} onChange={(e) => setForm({ ...form, deposito: e.target.value })} /></div>
                <div><FormLabel>Pasillo</FormLabel><Input value={form.pasillo} onChange={(e) => setForm({ ...form, pasillo: e.target.value })} /></div>
                <div><FormLabel>Estantería</FormLabel><Input value={form.estanteria} onChange={(e) => setForm({ ...form, estanteria: e.target.value })} /></div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Crear variante'}
                </Button>
                {editingId && <Button type="button" variant="outline" onClick={resetForm}>Cancelar edición</Button>}
                <span className="text-xs text-gray-500">Valores elegidos: {selectedValues.length}</span>
              </div>
            </form>
          </>
        )}
      </div>
    </Modal>
    <ConfirmModal
      open={Boolean(variantToDelete)}
      title="Eliminar variante"
      message={`¿Eliminar "${variantToDelete?.label ?? ''}"? Se quita del catálogo y sus códigos quedan libres. El historial de ventas y movimientos se conserva.`}
      confirmLabel="Eliminar"
      variant="danger"
      loading={deleting}
      onConfirm={() => void handleDeleteVariant()}
      onCancel={() => setVariantToDelete(null)}
    />
    </>
  );
}
