'use client';

import React, { useState, useEffect } from 'react';
import { useProducts } from '@/lib/hooks/useProducts';
import { useCategories } from '@/lib/hooks/useCategories';
import { useAuth } from '@/lib/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ConfirmModal } from '@/components/ui/confirm-modal';
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
  FolderKanban,
  ImageIcon,
  Upload,
  FileSpreadsheet,
  Download,
  Percent,
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
    image_url: '',
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Category Modal State
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    description: '',
    color: '#3b82f6',
  });
  const [isSubmittingCategory, setIsSubmittingCategory] = useState(false);
  const [isSubmittingProduct, setIsSubmittingProduct] = useState(false);

  // Import Excel State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, any>[]>([]);
  const [importColumns, setImportColumns] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<{ row: number; status: string; name?: string; error?: string }[] | null>(null);

  // Export State
  const [exporting, setExporting] = useState(false);

  // Price Adjustment State
  const [isPriceAdjustModalOpen, setIsPriceAdjustModalOpen] = useState(false);
  const [priceAdjustPercentage, setPriceAdjustPercentage] = useState('');
  const [priceAdjusting, setPriceAdjusting] = useState(false);
  const [priceAdjustResult, setPriceAdjustResult] = useState<{
    percentage: number; total: number; updated: number; sample?: any[]; errors?: any[];
  } | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResults(null);

    try {
      const buf = await file.arrayBuffer();
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      if (data.length === 0) {
        toast.error('El archivo está vacío');
        return;
      }

      const colMap: Record<string, string> = {
        nombre: 'name', producto: 'name', name: 'name',
        sku: 'sku', codigo: 'sku', código: 'sku',
        barcode: 'barcode', 'código de barras': 'barcode', 'codigo de barras': 'barcode', gtin: 'barcode',
        precio: 'price', price: 'price', 'precio venta': 'price',
        costo: 'cost', cost: 'cost',
        stock: 'stock', cantidad: 'stock',
        minimo: 'min_stock', 'stock mínimo': 'min_stock', 'min stock': 'min_stock', min_stock: 'min_stock',
        maximo: 'max_stock', 'stock máximo': 'max_stock', 'max stock': 'max_stock', max_stock: 'max_stock',
        descripcion: 'description', description: 'description',
        categoria: 'category_name', category: 'category_name',
      };

      const cols = Object.keys(data[0]);
      const mapped = data.map(row => {
        const mappedRow: Record<string, any> = {};
        for (const [col, val] of Object.entries(row)) {
          const key = colMap[col.toLowerCase().trim()] || col;
          mappedRow[key] = val;
        }
        if (mappedRow.price !== undefined) mappedRow.price = Number(String(mappedRow.price).replace(/[^0-9.,]/g, '').replace(',', '.'));
        if (mappedRow.cost !== undefined) mappedRow.cost = Number(String(mappedRow.cost).replace(/[^0-9.,]/g, '').replace(',', '.'));
        if (mappedRow.stock !== undefined) mappedRow.stock = Number(mappedRow.stock);
        if (mappedRow.min_stock !== undefined) mappedRow.min_stock = Number(mappedRow.min_stock);
        if (mappedRow.max_stock !== undefined) mappedRow.max_stock = Number(mappedRow.max_stock);
        return mappedRow;
      });

      setImportColumns(cols);
      setImportRows(mapped);
      toast.success(`${mapped.length} producto(s) leídos del archivo`);
    } catch {
      toast.error('Error al leer el archivo. Asegurate de que sea un Excel válido (.xlsx o .xls)');
    }
  };

  const handleImport = async () => {
    if (importRows.length === 0) return;
    setImporting(true);
    setImportResults(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/products/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ products: importRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al importar');

      setImportResults(data.results);
      toast.success(`Importación completada: ${data.summary.created} creados, ${data.summary.updated} actualizados`);
      mutateProducts();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    if (filteredProducts.length === 0) {
      toast.error('No hay productos para exportar');
      return;
    }

    setExporting(true);
    try {
      const XLSX = await import('xlsx');

      const data = filteredProducts.map((p) => {
        const cat = categories.find((c) => c.id === p.category_id);
        return {
          'Nombre': p.name,
          'Categoría': cat?.name || '',
          'SKU': p.sku || '',
          'Código de Barras': p.barcode || '',
          'Costo': p.cost ?? 0,
          'Precio Venta': p.price ?? 0,
          'Stock': p.stock ?? 0,
          'Stock Mínimo': p.min_stock ?? 0,
          'Stock Máximo': p.max_stock ?? 0,
        };
      });

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Productos');

      const now = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `productos_${now}.xlsx`);

      toast.success(`${data.length} producto(s) exportados`);
    } catch {
      toast.error('Error al exportar');
    } finally {
      setExporting(false);
    }
  };

  const handlePriceAdjust = async () => {
    const pct = parseFloat(priceAdjustPercentage);
    if (isNaN(pct) || pct <= 0) { toast.error('Ingresá un porcentaje válido'); return; }
    setPriceAdjusting(true);
    setPriceAdjustResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/products/adjust-prices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ percentage: pct }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al ajustar precios');

      setPriceAdjustResult(data);
      toast.success(`Precios actualizados: ${data.updated} de ${data.total} productos`);
      mutateProducts();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPriceAdjusting(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') === '1') {
      const barcode = params.get('barcode') || '';
      setProductForm((prev) => ({ ...prev, barcode }));
      setIsProductModalOpen(true);
    }
  }, []);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'delete-product' | 'delete-category';
    id: string;
  } | null>(null);

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
        image_url: product.image_url || '',
      });
      setImagePreview(product.image_url || null);
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
        image_url: '',
      });
      setImagePreview(null);
    }
    setImageFile(null);
    setIsProductModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productForm.name) {
      toast.error('El nombre del producto es requerido');
      return;
    }

    setIsSubmittingProduct(true);

    try {
      let imageUrl = productForm.image_url;

      if (imageFile) {
        setIsUploadingImage(true);
        const formData = new FormData();
        formData.append('file', imageFile);
        const { data: { session } } = await supabase.auth.getSession();
        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          headers: session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {},
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.error || 'Error al subir la imagen');
        imageUrl = uploadData.url;
        setIsUploadingImage(false);
      }

      const { data: { session } } = await supabase.auth.getSession();
      const url = editingProduct ? `/api/products/${editingProduct.id}` : '/api/products';
      const method = editingProduct ? 'PATCH' : 'POST';
      const sep = url.includes('?') ? '&' : '?';
      const res = await fetch(tenantId ? `${url}${sep}tenantId=${tenantId}` : url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ ...productForm, image_url: imageUrl }),
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
      setIsUploadingImage(false);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    setConfirmAction({ type: 'delete-product', id });
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryForm.name) {
      toast.error('El nombre de la categoría es requerido');
      return;
    }

    setIsSubmittingCategory(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(tenantId ? `/api/categories?tenantId=${tenantId}` : `/api/categories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
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
    setConfirmAction({ type: 'delete-category', id });
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { type, id } = confirmAction;
    setConfirmAction(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, any> = {};
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
      if (tenantId) headers['x-tenant-id'] = tenantId;

      if (type === 'delete-product') {
        const res = await fetch(tenantId ? `/api/products/${id}?tenantId=${tenantId}` : `/api/products/${id}`, { method: 'DELETE', headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al eliminar');
        toast.success('Producto eliminado');
        mutateProducts();
      } else if (type === 'delete-category') {
        const res = await fetch(tenantId ? `/api/categories/${id}?tenantId=${tenantId}` : `/api/categories/${id}`, { method: 'DELETE', headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al eliminar');
        toast.success('Categoría eliminada');
        mutateCategories();
      }
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
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setIsCategoryModalOpen(true)} className="flex items-center gap-1.5">
            <FolderKanban className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">Categorías</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setIsPriceAdjustModalOpen(true); setPriceAdjustResult(null); setPriceAdjustPercentage(''); }} className="flex items-center gap-1.5">
            <Percent className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">Ajustar</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsImportModalOpen(true)} className="flex items-center gap-1.5">
            <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">Importar</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} className="flex items-center gap-1.5">
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            ) : (
              <Download className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="hidden md:inline">{exporting ? 'Exportando...' : 'Exportar'}</span>
          </Button>
          <Button size="sm" onClick={() => handleOpenProductModal(null)} className="flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">Nuevo</span>
            <span className="md:hidden">Nuevo</span>
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
                        <div className="flex items-center gap-3">
                          {product.image_url && (
                            <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100 dark:bg-gray-800">
                              <img
                                src={product.image_url}
                                alt={product.name}
                                className="w-full h-full object-cover"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                              />
                            </div>
                          )}
                          <div>
                            <div className="font-semibold text-gray-900 dark:text-gray-100">{product.name}</div>
                            {product.description && (
                              <div className="text-xs text-gray-500 line-clamp-1 mt-0.5">{product.description}</div>
                            )}
                          </div>
                        </div>
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
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              >
                Anterior
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                .reduce<(number | '...')[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === '...' ? (
                    <span key={`dots-${i}`} className="px-1 text-gray-400 text-xs">…</span>
                  ) : (
                    <Button
                      key={p}
                      variant={currentPage === p ? 'primary' : 'outline'}
                      size="sm"
                      onClick={() => setCurrentPage(p)}
                      className="min-w-[28px] px-1"
                    >
                      {p}
                    </Button>
                  )
                )}
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

                {/* Image Upload */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Imagen del Producto
                  </label>
                  <div className="flex items-center gap-4">
                    <div
                      className="relative w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-gray-800 cursor-pointer hover:border-indigo-400 transition-colors"
                      onClick={() => document.getElementById('product-image-input')?.click()}
                    >
                      {imagePreview ? (
                        <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="h-6 w-6 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1">
                      <input
                        id="product-image-input"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setImageFile(file);
                            setImagePreview(URL.createObjectURL(file));
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => document.getElementById('product-image-input')?.click()}
                      >
                        <Upload className="h-3.5 w-3.5 mr-1.5" />
                        {imagePreview ? 'Cambiar imagen' : 'Subir imagen'}
                      </Button>
                      <p className="text-[10px] text-gray-400 mt-1">JPG, PNG, WebP o GIF. Máx 5MB.</p>
                    </div>
                    {imagePreview && (
                      <button
                        type="button"
                        onClick={() => {
                          setImageFile(null);
                          setImagePreview(null);
                          setProductForm({ ...productForm, image_url: '' });
                        }}
                        className="p-1 text-gray-400 hover:text-red-500 rounded"
                        title="Eliminar imagen"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
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

      {/* IMPORT EXCEL MODAL */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs">
          <Card className="w-full max-w-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 relative flex flex-col max-h-[90vh]">
            <button
              onClick={() => { setIsImportModalOpen(false); setImportRows([]); setImportColumns([]); setImportResults(null); }}
              className="absolute right-4 top-4 p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Importar productos desde Excel</h2>
            <p className="text-sm text-gray-500 mb-6">Subí un archivo .xlsx o .xls con los productos a importar.</p>

            {importRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl">
                <FileSpreadsheet className="h-12 w-12 text-gray-400 mb-4" />
                <p className="text-sm text-gray-500 mb-4">Seleccioná un archivo Excel para comenzar</p>
                <label className="cursor-pointer">
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
                  <span className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold rounded-lg text-sm transition-colors">
                    <Upload className="h-4 w-4" />
                    Seleccionar archivo
                  </span>
                </label>
              </div>
            ) : importResults ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-sm">
                  <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium">
                    {importResults.filter(r => r.status === 'created').length} creados
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">
                    {importResults.filter(r => r.status === 'updated').length} actualizados
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-medium">
                    {importResults.filter(r => r.status === 'skipped').length} omitidos
                  </span>
                </div>
                <div className="max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 uppercase">
                        <th className="py-2 px-4 text-left">Fila</th>
                        <th className="py-2 px-4 text-left">Producto</th>
                        <th className="py-2 px-4 text-left">Resultado</th>
                        <th className="py-2 px-4 text-left">Error</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {importResults.map(r => (
                        <tr key={r.row} className="text-xs">
                          <td className="py-2 px-4 text-gray-500">{r.row}</td>
                          <td className="py-2 px-4 text-gray-900 dark:text-gray-100">{r.name || '—'}</td>
                          <td className="py-2 px-4">
                            <span className={`font-medium ${
                              r.status === 'created' ? 'text-emerald-600' :
                              r.status === 'updated' ? 'text-blue-600' :
                              'text-red-600'
                            }`}>
                              {r.status === 'created' ? 'Creado' : r.status === 'updated' ? 'Actualizado' : 'Omitido'}
                            </span>
                          </td>
                          <td className="py-2 px-4 text-red-500">{r.error || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end">
                  <Button onClick={() => { setIsImportModalOpen(false); setImportRows([]); setImportColumns([]); setImportResults(null); }}>
                    Cerrar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>{importRows.length} producto(s) detectados</span>
                  <label className="cursor-pointer text-cyan-500 hover:text-cyan-400 font-medium flex items-center gap-1">
                    <Upload className="h-3.5 w-3.5" />
                    <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
                    Cambiar archivo
                  </label>
                </div>
                <div className="max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 uppercase">
                        <th className="py-2 px-4 text-left">#</th>
                        {importColumns.map(col => (
                          <th key={col} className="py-2 px-4 text-left">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {importRows.slice(0, 50).map((row, i) => (
                        <tr key={i} className="text-xs hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="py-2 px-4 text-gray-400">{i + 1}</td>
                          {importColumns.map(col => (
                            <td key={col} className="py-2 px-4 text-gray-900 dark:text-gray-100 max-w-[200px] truncate">
                              {String(row[col] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importRows.length > 50 && (
                    <p className="text-xs text-center text-gray-500 py-2 border-t border-gray-100 dark:border-gray-800">
                      Mostrando 50 de {importRows.length} filas
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <Button variant="outline" onClick={() => { setIsImportModalOpen(false); setImportRows([]); setImportColumns([]); setImportResults(null); }}>
                    Cancelar
                  </Button>
                  <Button onClick={handleImport} disabled={importing}>
                    {importing ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Importando...</>
                    ) : (
                      <>Importar {importRows.length} producto(s)</>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* PRICE ADJUST MODAL */}
      {isPriceAdjustModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs">
          <Card className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 relative">
            <button
              onClick={() => { setIsPriceAdjustModalOpen(false); setPriceAdjustResult(null); }}
              className="absolute right-4 top-4 p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Ajustar precios</h2>
            <p className="text-sm text-gray-500 mb-6">Aumentá el precio y costo de todos los productos por porcentaje.</p>

            {priceAdjustResult ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/30">
                  <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                    {priceAdjustResult.updated} de {priceAdjustResult.total} productos actualizados
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                    Aumento del {priceAdjustResult.percentage}% aplicado
                  </p>
                </div>
                {priceAdjustResult.errors && priceAdjustResult.errors.length > 0 && (
                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/30">
                    <p className="text-xs font-semibold text-red-700 dark:text-red-400">{priceAdjustResult.errors.length} error(es)</p>
                  </div>
                )}
                {priceAdjustResult.sample && priceAdjustResult.sample.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">Ejemplo de precios actualizados:</p>
                    <div className="space-y-1">
                      {priceAdjustResult.sample.map((p: any) => (
                        <div key={p.id} className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                          <span className="truncate max-w-[180px]">{p.name}</span>
                          <span>${(p.old_price_cents / 100).toFixed(2)} → ${(p.new_price_cents / 100).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <Button onClick={() => { setIsPriceAdjustModalOpen(false); setPriceAdjustResult(null); }} className="w-full">
                  Cerrar
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-gray-300">Porcentaje de aumento (%)</label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.1"
                      min="0.1"
                      placeholder="Ej: 2.1"
                      value={priceAdjustPercentage}
                      onChange={(e) => setPriceAdjustPercentage(e.target.value)}
                      className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5">
                    Se aplicará a precio de venta y costo de todos los productos.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <Button variant="outline" onClick={() => { setIsPriceAdjustModalOpen(false); setPriceAdjustResult(null); }}>
                    Cancelar
                  </Button>
                  <Button onClick={handlePriceAdjust} disabled={priceAdjusting || !priceAdjustPercentage}>
                    {priceAdjusting ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Aplicando...</>
                    ) : (
                      <>Aplicar aumento</>
                    )}
                  </Button>
                </div>
              </div>
            )}
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

      <ConfirmModal
        open={!!confirmAction}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
        title={
          confirmAction?.type === 'delete-product' ? 'Eliminar producto' :
          'Eliminar categoría'
        }
        message={
          confirmAction?.type === 'delete-product'
            ? '¿Estás seguro de que deseas eliminar este producto?'
            : '¿Deseas eliminar esta categoría? Los productos asociados se quedarán sin categoría.'
        }
        variant="danger"
        confirmLabel={
          confirmAction?.type === 'delete-product' ? 'Eliminar producto' :
          'Eliminar categoría'
        }
      />
    </div>
  );
}
