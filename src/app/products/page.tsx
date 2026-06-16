'use client';

import React, { useState } from 'react';
import { useProducts } from '@/lib/hooks/useProducts';
import { useCategories } from '@/lib/hooks/useCategories';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { Product } from '@/lib/types/product';
import type { Category } from '@/lib/types/category';
import toast from 'react-hot-toast';
import {
  Search,
  Plus,
  Edit,
  Trash2,
  AlertTriangle,
  Tag,
  Package,
  X,
  Check,
  Loader2,
  FolderKanban
} from 'lucide-react';

export default function ProductsPage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;
  const { products, isLoading: productsLoading, mutate: mutateProducts } = useProducts(tenantId);
  const { categories, isLoading: categoriesLoading, mutate: mutateCategories } = useCategories(tenantId);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'critical' | 'low' | 'normal'>('all');

  // Product Modal State
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState({
    name: '',
    category_id: '',
    sku: '',
    barcode: '',
    price: 0,
    cost: 0,
    stock: 0,
    min_stock: 0,
    max_stock: 0,
    description: '',
  });

  // Category Modal State
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    description: '',
    color: '#3b82f6',
  });
  const [isSubmittingCategory, setIsSubmittingCategory] = useState(false);
  const [isSubmittingProduct, setIsSubmittingProduct] = useState(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Filter Logic
  const filteredProducts = (products || []).filter((product) => {
    const matchesSearch =
      product.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sku?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.barcode?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory =
      selectedCategoryId === 'all' || product.category_id === selectedCategoryId;

    let matchesStock = true;
    const stockVal = product.stock ?? 0;
    const minVal = product.min_stock ?? 0;

    if (stockFilter === 'critical') {
      matchesStock = stockVal <= minVal;
    } else if (stockFilter === 'low') {
      matchesStock = stockVal > minVal && stockVal <= minVal * 1.5;
    } else if (stockFilter === 'normal') {
      matchesStock = stockVal > minVal * 1.5;
    }

    return matchesSearch && matchesCategory && matchesStock;
  });

  // Pagination Logic
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const paginatedProducts = filteredProducts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Handlers
  const handleOpenProductModal = (product: Product | null = null) => {
    if (product) {
      setEditingProduct(product);
      setProductForm({
        name: product.name || '',
        category_id: product.category_id || '',
        sku: product.sku || '',
        barcode: product.barcode || '',
        price: Number(product.price) || 0,
        cost: Number(product.cost) || 0,
        stock: product.stock ?? 0,
        min_stock: product.min_stock ?? 0,
        max_stock: product.max_stock ?? 0,
        description: product.description || '',
      });
    } else {
      setEditingProduct(null);
      setProductForm({
        name: '',
        category_id: categories[0]?.id || '',
        sku: '',
        barcode: '',
        price: 0,
        cost: 0,
        stock: 0,
        min_stock: 5,
        max_stock: 100,
        description: '',
      });
    }
    setIsProductModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productForm.name) {
      toast.error('El nombre del producto es requerido');
      return;
    }

    setIsSubmittingProduct(true);
    const url = editingProduct ? `/api/products/${editingProduct.id}` : '/api/products';
    const method = editingProduct ? 'PATCH' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
        },
        body: JSON.stringify(productForm),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar el producto');

      toast.success(editingProduct ? 'Producto actualizado' : 'Producto creado');
      setIsProductModalOpen(false);
      mutateProducts();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSubmittingProduct(false);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm('¿Estás seguro de que deseas eliminar este producto?')) return;

    try {
      const res = await fetch(`/api/products/${id}`, {
        method: 'DELETE',
        headers: tenantId ? { 'x-tenant-id': tenantId } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al eliminar');

      toast.success('Producto eliminado');
      mutateProducts();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryForm.name) {
      toast.error('El nombre de la categoría es requerido');
      return;
    }

    setIsSubmittingCategory(true);
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
        },
        body: JSON.stringify(categoryForm),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al crear la categoría');

      toast.success('Categoría creada');
      setCategoryForm({ name: '', description: '', color: '#3b82f6' });
      mutateCategories();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSubmittingCategory(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('¿Deseas eliminar esta categoría? Los productos asociados se quedarán sin categoría.')) return;

    try {
      const res = await fetch(`/api/categories/${id}`, {
        method: 'DELETE',
        headers: tenantId ? { 'x-tenant-id': tenantId } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al eliminar');

      toast.success('Categoría eliminada');
      mutateCategories();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upper Control Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Package className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
            Gestión de Inventario
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Administra tus productos, códigos de barras y niveles de stock crítico.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => setIsCategoryModalOpen(true)} className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4" />
            Categorías
          </Button>
          <Button onClick={() => handleOpenProductModal(null)} className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Nuevo Producto
          </Button>
        </div>
      </div>

      {/* Filters Card */}
      <Card className="p-4 border border-gray-100 dark:border-gray-800">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Buscar por nombre, SKU o barras..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          <div>
            <Select value={selectedCategoryId} onChange={(e) => setSelectedCategoryId(e.target.value)}>
              <option value="all">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as any)}
            >
              <option value="all">Cualquier nivel de stock</option>
              <option value="critical">Stock Crítico (menor al mínimo)</option>
              <option value="low">Stock Bajo (menor al 150% del mínimo)</option>
              <option value="normal">Stock Saludable</option>
            </Select>
          </div>

          <div className="flex items-center justify-end text-sm text-gray-500">
            Total filtrados: <strong>{filteredProducts.length}</strong>
          </div>
        </div>
      </Card>

      {/* Products Table */}
      <Card className="overflow-hidden border border-gray-100 dark:border-gray-800 p-0">
        {productsLoading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
            <p className="text-sm text-gray-500">Cargando inventario...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-20">
            <Package className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-lg font-medium text-gray-900 dark:text-gray-100">No se encontraron productos</p>
            <p className="text-sm text-gray-500 mt-1">Intenta ajustando los filtros de búsqueda.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-4 px-6">Producto</th>
                  <th className="py-4 px-6">Categoría</th>
                  <th className="py-4 px-6">SKU / Código</th>
                  <th className="py-4 px-6">Precios (Costo / Venta)</th>
                  <th className="py-4 px-6 text-center">Stock</th>
                  <th className="py-4 px-6 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                {paginatedProducts.map((product) => {
                  const category = categories.find((c) => c.id === product.category_id);
                  const isCritical = (product.stock ?? 0) <= (product.min_stock ?? 0);
                  const isLow = !isCritical && (product.stock ?? 0) <= (product.min_stock ?? 0) * 1.5;

                  return (
                    <tr key={product.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                      <td className="py-4 px-6">
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{product.name}</div>
                        {product.description && (
                          <div className="text-xs text-gray-500 line-clamp-1 mt-0.5">{product.description}</div>
                        )}
                      </td>
                      <td className="py-4 px-6">
                        {category ? (
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium"
                            style={{
                              backgroundColor: `${category.color || '#3b82f6'}15`,
                              color: category.color || '#3b82f6',
                            }}
                          >
                            <Tag className="h-3 w-3" />
                            {category.name}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 italic">Sin categoría</span>
                        )}
                      </td>
                      <td className="py-4 px-6">
                        <div className="text-gray-900 dark:text-gray-100 font-mono text-xs">
                          {product.sku || '—'}
                        </div>
                        {product.barcode && (
                          <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                            GTIN: {product.barcode}
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-6">
                        <div className="text-xs text-gray-500">
                          Costo: <span className="font-medium text-gray-700 dark:text-gray-300">${product.cost || 0}</span>
                        </div>
                        <div className="text-sm font-semibold text-green-600 dark:text-green-400 mt-0.5">
                          ${product.price}
                        </div>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <span
                            className={`inline-flex items-center justify-center w-10 h-10 rounded-full font-bold text-xs ${
                              isCritical
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                : isLow
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            }`}
                          >
                            {product.stock ?? 0}
                          </span>
                          <div className="text-left text-[10px] text-gray-400">
                            <div>Min: {product.min_stock ?? 0}</div>
                            <div>Max: {product.max_stock ?? 0}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleOpenProductModal(product)}
                            className="p-1.5 text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                            title="Editar"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteProduct(product.id)}
                            className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                            title="Eliminar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Panel */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800 px-6 py-4">
            <span className="text-xs text-gray-500">
              Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong>
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* PRODUCT DIALOG MODAL */}
      {isProductModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs">
          <Card className="w-full max-w-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 relative flex flex-col max-h-[90vh]">
            <button
              onClick={() => setIsProductModalOpen(false)}
              className="absolute right-4 top-4 p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              {editingProduct ? 'Editar Producto' : 'Agregar Nuevo Producto'}
            </h2>

            <form onSubmit={handleSaveProduct} className="space-y-4 overflow-y-auto pr-1 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Nombre del Producto *
                  </label>
                  <Input
                    type="text"
                    required
                    placeholder="Ej. Coca Cola 1.5L"
                    value={productForm.name}
                    onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Categoría
                  </label>
                  <Select
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

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Código de Barras / GTIN
                  </label>
                  <Input
                    type="text"
                    placeholder="Ej. 7791234567890"
                    value={productForm.barcode}
                    onChange={(e) => setProductForm({ ...productForm, barcode: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Código Interno / SKU
                  </label>
                  <Input
                    type="text"
                    placeholder="Ej. REF-COCA-1.5"
                    value={productForm.sku}
                    onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Costo ($)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={productForm.cost || ''}
                      onChange={(e) => setProductForm({ ...productForm, cost: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Precio ($) *
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      required
                      placeholder="0.00"
                      value={productForm.price || ''}
                      onChange={(e) => setProductForm({ ...productForm, price: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Stock Inicial
                    </label>
                    <Input
                      type="number"
                      value={productForm.stock}
                      onChange={(e) => setProductForm({ ...productForm, stock: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Mínimo Crítico
                    </label>
                    <Input
                      type="number"
                      value={productForm.min_stock}
                      onChange={(e) => setProductForm({ ...productForm, min_stock: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Máximo Sugerido
                    </label>
                    <Input
                      type="number"
                      value={productForm.max_stock}
                      onChange={(e) => setProductForm({ ...productForm, max_stock: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Descripción del producto
                  </label>
                  <textarea
                    className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    rows={3}
                    placeholder="Detalles del producto, empaque, etc."
                    value={productForm.description}
                    onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                <Button type="button" variant="outline" onClick={() => setIsProductModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isSubmittingProduct}>
                  {isSubmittingProduct ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Guardando...
                    </>
                  ) : (
                    'Guardar Cambios'
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* CATEGORIES MANAGER MODAL */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs">
          <Card className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 relative flex flex-col max-h-[85vh]">
            <button
              onClick={() => setIsCategoryModalOpen(false)}
              className="absolute right-4 top-4 p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Gestionar Categorías
            </h2>

            {/* List of categories */}
            <div className="mb-6 overflow-y-auto max-h-[40vh] border border-gray-100 dark:border-gray-800 rounded-md divide-y divide-gray-100 dark:divide-gray-800 p-2">
              {categories.length === 0 ? (
                <div className="text-center py-6 text-xs text-gray-500">
                  No hay categorías creadas.
                </div>
              ) : (
                categories.map((cat) => (
                  <div key={cat.id} className="flex items-center justify-between py-2 px-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3.5 h-3.5 rounded-full inline-block"
                        style={{ backgroundColor: cat.color || '#3b82f6' }}
                      />
                      <span className="font-medium text-gray-800 dark:text-gray-200">{cat.name}</span>
                    </div>
                    <button
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="p-1 hover:bg-red-50 hover:text-red-500 rounded text-gray-400"
                      title="Eliminar Categoría"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Add New Category Form */}
            <form onSubmit={handleCreateCategory} className="space-y-4 border-t border-gray-100 dark:border-gray-800 pt-4">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                Nueva Categoría
              </h3>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Nombre
                </label>
                <Input
                  type="text"
                  required
                  placeholder="Ej. Bebidas, Almacén"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Color Identificador
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    className="w-10 h-10 border border-gray-300 dark:border-gray-700 rounded-md cursor-pointer bg-transparent"
                    value={categoryForm.color}
                    onChange={(e) => setCategoryForm({ ...categoryForm, color: e.target.value })}
                  />
                  <Input
                    type="text"
                    className="font-mono"
                    value={categoryForm.color}
                    onChange={(e) => setCategoryForm({ ...categoryForm, color: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsCategoryModalOpen(false)}>
                  Cerrar
                </Button>
                <Button type="submit" disabled={isSubmittingCategory}>
                  {isSubmittingCategory ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      Creando...
                    </>
                  ) : (
                    'Agregar'
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
