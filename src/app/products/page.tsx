'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useProducts } from '@/lib/hooks/useProducts';
import { useCategories } from '@/lib/hooks/useCategories';
import { useAuth } from '@/lib/hooks/useAuth';
import { useExport } from '@/lib/hooks/useExport';
import { usePagination } from '@/lib/hooks/usePagination';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Modal } from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import { LoadingState } from '@/components/ui/loading-state';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { SearchInput } from '@/components/ui/search-input';
import { Thead, Th } from '@/components/ui/table-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { IconAction } from '@/components/ui/icon-action';
import { Tooltip } from '@/components/ui/tooltip';
import type { Product } from '@/lib/types/product';
import type { Category } from '@/lib/types/category';
import toast from 'react-hot-toast';
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Tag,
  Package,
  X,
  Loader2,
  FolderKanban,
  Upload,
  FileSpreadsheet,
  Download,
  Percent,
  ArrowRightLeft,
  ChevronDown,
  Settings2,
  Scan,
} from 'lucide-react';
import { formatARS, groupThousands, parseAmountInput, amountToInput } from '@/lib/utils/currency';
import { getTenantHeaders, authFetch } from '@/lib/fetchWithTenant';
import { filterProducts } from '@/lib/product-search';
import { IMPORT_FILE_ERROR, parseWorkbookFile, validateSpreadsheetFile } from '@/lib/excel-import-parse';
import { matchesQuery } from '@/lib/utils/text';
import { TransferInbox } from '@/components/transfers/TransferInbox';
import { SortableTh, SortDir } from '@/components/ui/sortable-th';
import { FormLabel } from '@/components/ui/form-label';

type ImportProgressState = { processed: number; total: number };

type ImportStreamResult = {
  results: { row: number; status: string; name?: string; error?: string }[];
  summary: { created: number; updated: number; skipped: number; total: number };
};

/**
 * Lee el NDJSON que streamea /api/products/import.
 *
 * El servidor manda una linea por evento: `progress` mientras escribe cada
 * fila y un `done` final con el reporte. Se corta por '\n' a medida que llegan
 * los chunks (y no al final) justamente para que el contador avance durante el
 * import; un chunk de red puede traer varias lineas o media linea, por eso el
 * sobrante queda en `buffer` hasta el proximo chunk.
 */
async function readImportStream(
  body: ReadableStream<Uint8Array>,
  onProgress: (progress: ImportProgressState) => void,
): Promise<ImportStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const collected: { result: ImportStreamResult | null } = { result: null };
  let buffer = '';

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event.type === 'progress') {
      onProgress({ processed: Number(event.processed), total: Number(event.total) });
    } else if (event.type === 'done') {
      collected.result = {
        results: (event.results ?? []) as ImportStreamResult['results'],
        summary: event.summary as ImportStreamResult['summary'],
      };
    } else if (event.type === 'error') {
      throw new Error(String(event.error || 'Error al importar'));
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  if (buffer.trim()) handleLine(buffer);

  if (!collected.result) throw new Error('La importacion no devolvio resultados');
  return collected.result;
}

function marginPercent(price: number, cost: number): number {
  return ((price - cost) / cost) * 100;
}

type SortKey = 'name' | 'category' | 'location' | 'sku' | 'cost' | 'price' | 'stock';

interface PriceAdjustSample {
  id: string;
  name: string;
  old_price_cents: number;
  new_price_cents: number;
}

interface TransferProduct {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
}

export default function ProductsPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        </div>
      }
    >
      <ProductsPageContent />
    </React.Suspense>
  );
}

function ProductsPageContent() {
  const { tenant, tenants } = useAuth();
  const tenantId = tenant?.id ?? null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const multiBranch = (tenants?.length || 0) > 1;
  const { products, isLoading: productsLoading, mutate: mutateProducts, isError: productsError } = useProducts(tenantId);
  const { categories, mutate: mutateCategories } = useCategories(tenantId);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'critical' | 'low' | 'normal'>(() => {
    const s = searchParams?.get('stock');
    return s === 'critical' || s === 'low' || s === 'normal' ? s : 'all';
  });

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
    deposito: '',
    pasillo: '',
    estanteria: '',
    description: '',
    image_url: '',
    image_storage_path: '',
  });
  const [imageFile, setImageFile] = useState<File | null>(null);

  // Los inputs de precio y costo muestran los miles separados ("80.000"), asi que
  // necesitan un draft de texto: type="number" no acepta separadores.
  const [amountDraft, setAmountDraft] = useState<{ price?: string; cost?: string }>({});
  const priceDisplay = amountDraft.price ?? amountToInput(productForm.price);
  const costDisplay = amountDraft.cost ?? amountToInput(productForm.cost);

  const handleAmountChange = (field: 'price' | 'cost') => (raw: string) => {
    const formatted = groupThousands(raw);
    setAmountDraft((prev) => ({ ...prev, [field]: formatted }));
    setProductForm((prev) => ({ ...prev, [field]: parseAmountInput(formatted) }));
  };

  // Category Modal State
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    description: '',
    color: '#3b82f6',
  });
  const [isSubmittingCategory, setIsSubmittingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    color: '#3b82f6',
  });
  const [isUpdatingCategory, setIsUpdatingCategory] = useState(false);
  const [isSubmittingProduct, setIsSubmittingProduct] = useState(false);

  // Import Excel State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, unknown>[]>([]);
  const [importColumns, setImportColumns] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<{ row: number; status: string; name?: string; error?: string }[] | null>(null);
  const [showColumnInfo, setShowColumnInfo] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);

  // Export State
  const { exporting, busy, run } = useExport();

  // Transfer State
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transfersTrigger, setTransfersTrigger] = useState(0);

  // Actions Dropdown State
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Price Adjustment State
  const [isPriceAdjustModalOpen, setIsPriceAdjustModalOpen] = useState(false);
  const [priceAdjustPercentage, setPriceAdjustPercentage] = useState('');
  const [priceAdjustScope, setPriceAdjustScope] = useState<'all' | 'category'>('all');
  const [priceAdjustCategoryId, setPriceAdjustCategoryId] = useState('');
  const [priceAdjusting, setPriceAdjusting] = useState(false);
  const [priceAdjustResult, setPriceAdjustResult] = useState<{
    percentage: number; total: number; updated: number; sample?: PriceAdjustSample[]; errors?: string[];
  } | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResults(null);

    // Nombre, peso y tipo se miran antes de `arrayBuffer()`: leer el buffer
    // de un archivo enorme es lo que cuelga la pestaña, y el atributo
    // `accept` del input es solo una sugerencia que se esquiva con "mostrar
    // todos los archivos".
    const check = validateSpreadsheetFile(file);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }

    try {
      const buf = await file.arrayBuffer();
      const parsed = await parseWorkbookFile(buf);
      if (!parsed.ok) {
        toast.error(parsed.error);
        return;
      }

      setImportColumns(parsed.columns);
      setImportRows(parsed.rows);
      toast.success(`${parsed.rows.length} producto(s) leídos del archivo`);
    } catch {
      toast.error(IMPORT_FILE_ERROR);
    }
  };

  const handleImport = async () => {
    if (importRows.length === 0) return;
    setImporting(true);
    setImportResults(null);
    setImportProgress(null);

    try {
      const res = await authFetch('/api/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: importRows }),
      });

      // Las guardas (401/403/413/429) siguen llegando como JSON con su status;
      // el stream recién arranca cuando el servidor ya aceptó el archivo. Por
      // eso el chequeo de `res.ok` va antes de tocar `res.body`.
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Error al importar');
      }

      const data = await readImportStream(res.body, (progress) => setImportProgress(progress));

      setImportResults(data.results);
      const { created, updated, skipped } = data.summary;
      // Un import con filas omitidas no es un import limpio: el toast lo
      // dice, porque el detalle fila por fila queda escondido en la tabla de
      // resultados y un verde sin mas parece que las 2000 filas entraron.
      if (skipped > 0) {
        toast.error(
          `Importación terminada con ${skipped} fila(s) omitidas: ${created} creados, ${updated} actualizados. Revisá la tabla de resultados.`,
          { duration: 8000 },
        );
      } else {
        toast.success(`Importación completada: ${created} creados, ${updated} actualizados`);
      }
      mutateProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const handleExport = async () => {
    if (filteredProducts.length === 0) {
      toast.error('No hay productos para exportar');
      return;
    }

    await run(async () => {
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
            'Depósito': p.deposito || '',
            'Pasillo': p.pasillo || '',
            'Estantería': p.estanteria || '',
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
      }
    });
  };

  const handlePriceAdjust = async () => {
    const pct = parseFloat(priceAdjustPercentage);
    if (isNaN(pct) || pct <= 0) { toast.error('Ingresá un porcentaje válido'); return; }
    if (priceAdjustScope === 'category' && !priceAdjustCategoryId) {
      toast.error('Seleccioná una categoría');
      return;
    }
    setPriceAdjusting(true);
    setPriceAdjustResult(null);

    try {
      const res = await authFetch('/api/products/adjust-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          percentage: pct,
          category_id: priceAdjustScope === 'category' ? priceAdjustCategoryId : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al ajustar precios');

      setPriceAdjustResult(data);
      toast.success(`Precios actualizados: ${data.updated} de ${data.total} productos`);
      mutateProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setPriceAdjusting(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') === '1') {
      const barcode = params.get('barcode') || '';
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProductForm((prev) => ({ ...prev, barcode }));
      setIsProductModalOpen(true);
    }
  }, []);

  // Close actions menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setIsActionsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'delete-product' | 'delete-category';
    id: string;
  } | null>(null);

  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Filter Logic
  const filteredProducts = filterProducts(products || [], {
    searchTerm,
    categoryId: selectedCategoryId,
    stockFilter,
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setCurrentPage(1);
  };

  const categoryNameOf = (p: Product) => categories.find((c) => c.id === p.category_id)?.name || 'Sin categoría';

  const sortedProducts = sortKey
    ? [...filteredProducts].sort((a, b) => {
        let va: string | number;
        let vb: string | number;
        switch (sortKey) {
          case 'name': va = a.name; vb = b.name; break;
          case 'category': va = categoryNameOf(a).toLocaleLowerCase(); vb = categoryNameOf(b).toLocaleLowerCase(); break;
          case 'location': va = `${a.deposito || ''} ${a.pasillo || ''} ${a.estanteria || ''}`.trim().toLocaleLowerCase(); vb = `${b.deposito || ''} ${b.pasillo || ''} ${b.estanteria || ''}`.trim().toLocaleLowerCase(); break;
          case 'sku': va = a.sku || ''; vb = b.sku || ''; break;
          case 'cost': va = a.cost ?? 0; vb = b.cost ?? 0; break;
          case 'price': va = a.price ?? 0; vb = b.price ?? 0; break;
          case 'stock': va = a.stock ?? 0; vb = b.stock ?? 0; break;
          default: return 0;
        }
        const cmp = typeof va === 'string' && typeof vb === 'string'
          ? va.localeCompare(vb, 'es', { sensitivity: 'base' })
          : (va as number) - (vb as number);
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : filteredProducts;

  // Pagination Logic
  const { currentPage, setCurrentPage, totalPages, pageItems: paginatedProducts } = usePagination(sortedProducts, 8);

  // Handlers
  const handleOpenProductModal = useCallback((product: Product | null = null) => {
    setAmountDraft({});
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
        deposito: product.deposito || '',
        pasillo: product.pasillo || '',
        estanteria: product.estanteria || '',
        description: product.description || '',
        image_url: product.image_url || '',
        image_storage_path: product.image_storage_path || '',
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
        deposito: '',
        pasillo: '',
        estanteria: '',
        description: '',
        image_url: '',
        image_storage_path: '',
      });
    }
    setImageFile(null);
    setIsProductModalOpen(true);
  }, [categories]);

  // Deep-link: /products?edit=<id> abre directo el modal de ese producto. Lo usa la
  // lista de "se venden bajo su costo" del forecast. Mismo patron que el ?create=1
  // de mas arriba, pero espera a que el catalogo cargue. El ref evita que el modal
  // se reabra si el usuario lo cierra.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('edit');
    if (!id || deepLinkHandled.current || productsLoading) return;
    const target = (products ?? []).find((p) => p.id === id);
    if (!target) return;
    deepLinkHandled.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    handleOpenProductModal(target);
  }, [products, productsLoading, handleOpenProductModal]);

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productForm.name) {
      toast.error('El nombre del producto es requerido');
      return;
    }

    setIsSubmittingProduct(true);

    try {
      const imageUrl = productForm.image_url;
      let imageStoragePath = productForm.image_storage_path ?? '';

      if (imageFile) {
        const formData = new FormData();
        formData.append('file', imageFile);
        const uploadRes = await authFetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.error || 'Error al subir la imagen');
        imageStoragePath = uploadData.storagePath ?? '';
        if (!imageStoragePath) throw new Error('La imagen se subió pero no se pudo identificar');
      }

      const url = editingProduct ? `/api/products/${editingProduct.id}` : '/api/products';
      const method = editingProduct ? 'PATCH' : 'POST';
      const sep = url.includes('?') ? '&' : '?';
      const res = await authFetch(tenantId ? `${url}${sep}tenantId=${tenantId}` : url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...getTenantHeaders(),
        },
        body: JSON.stringify({ ...productForm, image_url: imageUrl, image_storage_path: imageStoragePath }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar el producto');

      toast.success(editingProduct ? 'Producto actualizado' : 'Producto creado');
      setIsProductModalOpen(false);
      mutateProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setIsSubmittingProduct(false);
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
      const res = await authFetch(tenantId ? `/api/categories?tenantId=${tenantId}` : `/api/categories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getTenantHeaders(),
        },
        body: JSON.stringify(categoryForm),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al crear la categoría');

      toast.success('Categoría creada');
      setCategoryForm({ name: '', description: '', color: '#3b82f6' });
      mutateCategories();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setIsSubmittingCategory(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    setConfirmAction({ type: 'delete-category', id });
  };

  const handleStartEditCategory = (cat: Category) => {
    if (editingCategoryId === cat.id) {
      setEditingCategoryId(null);
      return;
    }
    setEditingCategoryId(cat.id);
    setEditForm({ name: cat.name, color: cat.color || '#3b82f6' });
  };

  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategoryId) return;
    if (!editForm.name) {
      toast.error('El nombre de la categoría es requerido');
      return;
    }

    setIsUpdatingCategory(true);
    try {
      const res = await authFetch(tenantId ? `/api/categories/${editingCategoryId}?tenantId=${tenantId}` : `/api/categories/${editingCategoryId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getTenantHeaders(),
        },
        body: JSON.stringify(editForm),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al actualizar la categoría');

      toast.success('Categoría actualizada');
      setEditingCategoryId(null);
      mutateCategories();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setIsUpdatingCategory(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { type, id } = confirmAction;
    setConfirmAction(null);

    try {
      const headers = {
        ...getTenantHeaders(),
      };

      if (type === 'delete-product') {
        const res = await authFetch(tenantId ? `/api/products/${id}?tenantId=${tenantId}` : `/api/products/${id}`, { method: 'DELETE', headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al eliminar');
        toast.success('Producto eliminado');
        mutateProducts();
      } else if (type === 'delete-category') {
        const res = await authFetch(tenantId ? `/api/categories/${id}?tenantId=${tenantId}` : `/api/categories/${id}`, { method: 'DELETE', headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al eliminar');
        toast.success('Categoría eliminada');
        mutateCategories();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Upper Control Bar */}
      <PageHeader
        icon={<Package className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />}
        title="Gestión de Inventario"
        subtitle="Administra tus productos, códigos de barras y niveles de stock crítico."
        actions={
          <>
          {/* Actions Dropdown */}
          <div className="relative" ref={actionsMenuRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsActionsMenuOpen((prev) => !prev)}
              className="flex items-center gap-1.5"
            >
              <Settings2 className="h-3.5 w-3.5 shrink-0" />
              <span>Gestionar</span>
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${isActionsMenuOpen ? 'rotate-180' : ''}`} />
            </Button>

            {isActionsMenuOpen && (
              <div className="absolute left-0 sm:left-auto sm:right-0 mt-1.5 w-52 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl z-50 overflow-hidden">
                <div className="py-1">
                  <button
                    onClick={() => { setIsCategoryModalOpen(true); setIsActionsMenuOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <FolderKanban className="h-4 w-4 text-indigo-500 shrink-0" />
                    Categorías
                  </button>
                  <button
                    onClick={() => { setIsPriceAdjustModalOpen(true); setPriceAdjustResult(null); setPriceAdjustPercentage(''); setPriceAdjustScope('all'); setPriceAdjustCategoryId(''); setIsActionsMenuOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <Percent className="h-4 w-4 text-amber-500 shrink-0" />
                    Ajustar precios
                  </button>
                  <button
                    onClick={() => { setIsActionsMenuOpen(false); router.push('/scanning?mode=stockin'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <Scan className="h-4 w-4 text-teal-500 shrink-0" />
                    Carga de inventario
                  </button>
                  <button
                    onClick={() => { setIsImportModalOpen(true); setIsActionsMenuOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-emerald-500 shrink-0" />
                    Importar
                  </button>
                  <button
                    onClick={() => { handleExport(); setIsActionsMenuOpen(false); }}
                    disabled={busy}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                  >
                    {exporting ? (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
                    ) : (
                      <Download className="h-4 w-4 text-blue-500 shrink-0" />
                    )}
                    {exporting ? 'Exportando...' : 'Exportar'}
                  </button>
                  {multiBranch && (
                    <>
                      <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
                      <button
                        onClick={() => { setIsTransferModalOpen(true); setIsActionsMenuOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        <ArrowRightLeft className="h-4 w-4 text-purple-500 shrink-0" />
                        Transferencias
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* New Product Button */}
          <Button size="sm" onClick={() => handleOpenProductModal(null)} className="flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5 shrink-0" />
            Nuevo
          </Button>
          </>
        }
      />

      {/* Transfer Inbox — active transfers for multi-branch */}
      {multiBranch && tenantId && (
        <TransferInbox currentTenantId={tenantId} trigger={transfersTrigger} onAction={() => mutateProducts()} />
      )}

      {/* Filters Card */}
      <Card className="p-4 border border-gray-100 dark:border-gray-800">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <SearchInput
              ref={searchInputRef}
              placeholder="Buscar por nombre, SKU o barras..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            />
          </div>

          <div>
            <Select value={selectedCategoryId} onChange={(e) => { setSelectedCategoryId(e.target.value); setCurrentPage(1); }}>
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
              aria-label="Nivel de stock"
              value={stockFilter}
              onChange={(e) => { setStockFilter(e.target.value as 'all' | 'critical' | 'low' | 'normal'); setCurrentPage(1); }}
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
        {productsError ? (
          <ErrorState title="No se pudieron cargar los productos" onRetry={() => mutateProducts()} />
        ) : productsLoading ? (
          <LoadingState label="Cargando inventario..." />
        ) : filteredProducts.length === 0 ? (
          <EmptyState icon={Package} title="No se encontraron productos" description="Intenta ajustando los filtros de búsqueda." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <Thead>
                <SortableTh label="Producto" sortFor="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-6" />
                <SortableTh label="Categoría" sortFor="category" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-3" />
                <SortableTh label="Ubicación" sortFor="location" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-3" />
                <SortableTh label="SKU / Código" sortFor="sku" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-6" />
                <SortableTh label="Precios (Costo / Venta)" sortFor="price" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-6" />
                <SortableTh label="Stock" sortFor="stock" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-6" align="center" />
                <Th align="right">Acciones</Th>
              </Thead>
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
                              {/* eslint-disable-next-line @next/next/no-img-element */}
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
                      <td className="py-4 px-3">
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
                      <td className="py-4 px-3">
                        {product.deposito || product.pasillo || product.estanteria ? (
                          <div className="text-xs text-gray-700 dark:text-gray-300 leading-tight whitespace-nowrap">
                            <p>{product.deposito ? <>Depósito: {product.deposito}</> : <span className="text-gray-300 dark:text-gray-600">Depósito: —</span>}</p>
                            <p className="mt-0.5">{product.pasillo ? <>Pasillo: {product.pasillo}</> : <span className="text-gray-300 dark:text-gray-600">Pasillo: —</span>}</p>
                            <p className="mt-0.5">{product.estanteria ? <>Estantería: {product.estanteria}</> : <span className="text-gray-300 dark:text-gray-600">Estantería: —</span>}</p>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 italic">—</span>
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
                          Costo: <span className="font-medium text-gray-700 dark:text-gray-300">{formatARS(product.cost || 0)}</span>
                        </div>
                        <div className="text-sm font-semibold text-green-600 dark:text-green-400 mt-0.5">
                          {formatARS(product.price)}
                        </div>
                        {product.cost != null && product.cost > 0 && product.price > 0 && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            Margen: <span className={`font-medium ${marginPercent(product.price, product.cost) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                              {marginPercent(product.price, product.cost) >= 0 ? '+' : ''}{marginPercent(product.price, product.cost).toFixed(0)}%
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-6 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <span
                            className={`inline-flex items-center justify-center w-10 h-10 rounded-full font-bold text-xs ${isCritical
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                : isLow
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              }`}
                          >
                            {product.stock ?? 0}
                          </span>
                          <div className="text-left text-[10px] text-gray-400">
                            <div>Ideal: {product.min_stock ?? 0} - {product.max_stock ?? 0}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <IconAction
                            icon={Edit}
                            label={`Editar ${product.name}`}
                            title="Editar"
                            tone="indigo"
                            onClick={() => handleOpenProductModal(product)}
                          />
                          <IconAction
                            icon={Trash2}
                            label={`Eliminar ${product.name}`}
                            title="Eliminar"
                            tone="red"
                            onClick={() => handleDeleteProduct(product.id)}
                          />
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
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </Card>

      {/* PRODUCT DIALOG MODAL */}
      {isProductModalOpen && (
        <Modal
          aria-label="Producto"
          onClose={() => setIsProductModalOpen(false)}
          className="max-w-2xl flex flex-col max-h-[90vh]"
          title={editingProduct ? 'Editar Producto' : 'Agregar Nuevo Producto'}
        >
          <form onSubmit={handleSaveProduct} className="space-y-4 overflow-y-auto pr-1 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <FormLabel htmlFor="product-name">
                    Nombre del Producto *
                  </FormLabel>
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
                  <FormLabel htmlFor="product-category">
                    Categoría
                  </FormLabel>
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
                    <FormLabel htmlFor="product-barcode">
                      Código de Barras / GTIN
                    </FormLabel>
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
                    <FormLabel htmlFor="product-sku">
                      SKU
                    </FormLabel>
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

                <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                  <div>
                    <FormLabel htmlFor="product-cost">
                      Costo ($)
                    </FormLabel>
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
                    <FormLabel htmlFor="product-price">
                      Precio ($)
                    </FormLabel>
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
                    <FormLabel>
                      Margen
                    </FormLabel>
                    <Input
                      type="text"
                      readOnly
                      className={`bg-gray-50 dark:bg-gray-800 cursor-not-allowed font-medium ${productForm.cost > 0 && productForm.price > 0 && marginPercent(productForm.price, productForm.cost) >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                        }`}
                      value={
                        productForm.cost > 0 && productForm.price > 0
                          ? `${marginPercent(productForm.price, productForm.cost) >= 0 ? '+' : ''}${marginPercent(productForm.price, productForm.cost).toFixed(0)}%`
                          : '—'
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                  <div>
                    <FormLabel htmlFor="product-stock" className="text-[10px]">
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
                    <FormLabel htmlFor="product-min-stock" className="text-[10px]">
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
                    <FormLabel htmlFor="product-max-stock" className="text-[10px]">
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
                  <FormLabel>
                    Ubicación en depósito
                  </FormLabel>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <FormLabel htmlFor="product-deposito" className="text-[10px]">
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
                      <FormLabel htmlFor="product-pasillo" className="text-[10px]">
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
                      <FormLabel htmlFor="product-estanteria" className="text-[10px]">
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
                  <FormLabel htmlFor="product-description">
                    Descripción del producto
                  </FormLabel>
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
        </Modal>
      )}

      {/* IMPORT EXCEL MODAL */}
      {isImportModalOpen && (
        <Modal
          onClose={() => { setIsImportModalOpen(false); setImportRows([]); setImportColumns([]); setImportResults(null); setShowColumnInfo(false); }}
          className="max-w-3xl flex flex-col max-h-[90vh]"
        >
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Importar productos desde Excel</h2>
              <Tooltip content="Solo 'Nombre' es obligatorio. Las demás columnas son opcionales y podés usar nombres en español o inglés.">
                <button
                  type="button"
                  onClick={() => setShowColumnInfo(!showColumnInfo)}
                  aria-expanded={showColumnInfo}
                  aria-controls="import-column-info"
                  className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
                >
                  {showColumnInfo ? 'Ocultar columnas' : '¿Qué columnas usar?'}
                </button>
              </Tooltip>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Subí un archivo <span className="font-medium text-gray-700 dark:text-gray-300">.xlsx o .xls</span> con los productos a importar. Revisá{' '}
              <button
                type="button"
                onClick={() => setShowColumnInfo(true)}
                className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
              >
                qué columnas usar
              </button>{' '}
              antes de subirlo.
            </p>

            {showColumnInfo && (
              <div id="import-column-info" className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-6 text-xs text-gray-600 dark:text-gray-400 space-y-1.5">
                <p className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Columnas del archivo:</p>
                <div><span className="font-medium text-gray-900 dark:text-gray-100">Nombre *</span> — obligatorio. Ej: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">Coca Cola 1.5L</code></div>
                <div><span className="font-medium text-gray-900 dark:text-gray-100">Precio</span> — precio de venta. Ej: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">1500</code></div>
                <div><span className="font-medium text-gray-900 dark:text-gray-100">Costo</span> — costo del producto. Ej: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">800</code></div>
                <div><span className="font-medium text-gray-900 dark:text-gray-100">SKU</span> — código interno. Ej: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">REF-COCA-1.5</code></div>
                <div><span className="font-medium text-gray-900 dark:text-gray-100">Código de barras</span> — GTIN / EAN. Ej: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">7791234567890</code></div>
                <div><span className="font-medium text-gray-900 dark:text-gray-100">Stock</span> — cantidad inicial. Ej: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">50</code></div>
                <div><span className="font-medium text-gray-900 dark:text-gray-100">Stock mínimo</span> — nivel crítico. Ej: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">10</code></div>
                <div><span className="font-medium text-gray-900 dark:text-gray-100">Stock máximo</span> — nivel sugerido. Ej: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">100</code></div>
                <div><span className="font-medium text-gray-900 dark:text-gray-100">Categoría</span> — se crea si no existe. Ej: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">Bebidas</code></div>
                <div><span className="font-medium text-gray-900 dark:text-gray-100">Descripción</span> — detalle del producto. Ej: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">Gaseosa sabor cola</code></div>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 pt-1">Las columnas son opcionales excepto <strong>Nombre</strong>. Podés usar nombres en español o inglés.</p>
              </div>
            )}

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
                  <StatusBadge size="md" tone="emerald" className="font-medium">
                    {importResults.filter(r => r.status === 'created').length} creados
                  </StatusBadge>
                  <StatusBadge size="md" tone="blue" className="font-medium">
                    {importResults.filter(r => r.status === 'updated').length} actualizados
                  </StatusBadge>
                  <StatusBadge size="md" tone="grayMuted" className="font-medium">
                    {importResults.filter(r => r.status === 'skipped').length} omitidos
                  </StatusBadge>
                </div>
                <div className="max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                  <table className="w-full text-sm">
                    <Thead>
                      <Th>Fila</Th>
                      <Th>Producto</Th>
                      <Th>Resultado</Th>
                      <Th>Error</Th>
                    </Thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {importResults.map(r => (
                        <tr key={r.row} className="text-xs">
                          <td className="py-2 px-4 text-gray-500">{r.row}</td>
                          <td className="py-2 px-4 text-gray-900 dark:text-gray-100">{r.name || '—'}</td>
                          <td className="py-2 px-4">
                            <span className={`font-medium ${r.status === 'created' ? 'text-emerald-600' :
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
                  <Button onClick={() => { setIsImportModalOpen(false); setImportRows([]); setImportColumns([]); setImportResults(null); setShowColumnInfo(false); }}>
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
                    <Thead>
                      <Th>#</Th>
                      {importColumns.map(col => (
                        <Th key={col}>{col}</Th>
                      ))}
                    </Thead>
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
                {importing && importProgress && (
                  <div>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                      <span>Procesando {importProgress.processed} de {importProgress.total}</span>
                      <span>{Math.round((importProgress.processed / Math.max(1, importProgress.total)) * 100)}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        className="h-full rounded-full bg-cyan-500 transition-all duration-200"
                        style={{ width: `${Math.round((importProgress.processed / Math.max(1, importProgress.total)) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <Button variant="outline" onClick={() => { setIsImportModalOpen(false); setImportRows([]); setImportColumns([]); setImportResults(null); setShowColumnInfo(false); }}>
                    Cancelar
                  </Button>
                  <Button onClick={handleImport} disabled={importing}>
                    {importing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Importando
                        {/* El detalle "437 de 2000" ya esta en la barra de
                            arriba: en el boton alcanza con la senal de "esto
                            esta trabajando". Los tres puntos laten de a uno, en
                            loop, para que se note que la pantalla no se
                            congelo y no parece que el import se trabo. */}
                        <span className="inline-flex items-center" aria-hidden="true">
                          {[0, 1, 2].map((i) => (
                            <span
                              key={i}
                              className="animate-pulse text-lg leading-none"
                              style={{ animationDelay: `${i * 200}ms` }}
                            >
                              .
                            </span>
                          ))}
                        </span>
                        <span className="sr-only">en curso</span>
                      </>
                    ) : (
                      <>Importar {importRows.length} producto(s)</>
                    )}
                  </Button>
                </div>
              </div>
            )}
        </Modal>
      )}

      {/* PRICE ADJUST MODAL */}
      {isPriceAdjustModalOpen && (
        <Modal
          onClose={() => { setIsPriceAdjustModalOpen(false); setPriceAdjustResult(null); }}
          className="max-w-md"
          title="Ajustar precios"
          titleClassName="mb-1"
        >
          <p className="text-sm text-gray-500 mb-6">Aumentá el precio y costo de los productos por porcentaje.</p>

            {priceAdjustResult ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/30">
                  <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                    {priceAdjustResult.updated} de {priceAdjustResult.total} productos actualizados
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                    Aumento del {priceAdjustResult.percentage}% aplicado
                    {priceAdjustCategoryId ? ` a la categoría "${categories.find((c) => c.id === priceAdjustCategoryId)?.name ?? ''}"` : ' a todos los productos'}
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
                      {priceAdjustResult.sample.map((p) => (
                        <div key={p.id} className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                          <span className="truncate max-w-[180px]">{p.name}</span>
                          <span>{formatARS(p.old_price_cents / 100)} → {formatARS(p.new_price_cents / 100)}</span>
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
                  <FormLabel variant="default" className="text-gray-300 mb-1.5">Alcance del ajuste</FormLabel>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPriceAdjustScope('all')}
                      className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        priceAdjustScope === 'all'
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 font-medium'
                          : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      <Package className="h-4 w-4 shrink-0" />
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setPriceAdjustScope('category')}
                      className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        priceAdjustScope === 'category'
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 font-medium'
                          : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      <FolderKanban className="h-4 w-4 shrink-0" />
                      Por categoría
                    </button>
                  </div>
                </div>

                {priceAdjustScope === 'category' && (
                  <div>
                    <FormLabel variant="default" className="text-gray-300 mb-1.5">Categoría</FormLabel>
                    <Select value={priceAdjustCategoryId} onChange={(e) => setPriceAdjustCategoryId(e.target.value)} className="bg-gray-800 border-gray-700 text-white hover:bg-gray-700" darkPanel>
                      <option value="">Seleccionar categoría...</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </Select>
                  </div>
                )}

                <div>
                  <FormLabel variant="default" className="text-gray-300 mb-1.5">Porcentaje de aumento (%)</FormLabel>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.1"
                      min="0.1"
                      placeholder="Ej: 2.1"
                      value={priceAdjustPercentage}
                      onChange={(e) => setPriceAdjustPercentage(e.target.value)}
                      className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-400 pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5">
                    {priceAdjustScope === 'all'
                      ? 'Se aplicará a precio de venta y costo de todos los productos.'
                      : 'Se aplicará a precio de venta y costo de los productos de la categoría seleccionada.'}
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
        </Modal>
      )}

      {/* CATEGORIES MANAGER MODAL */}
      {isCategoryModalOpen && (
        <Modal
          onClose={() => setIsCategoryModalOpen(false)}
          className="max-w-md flex flex-col max-h-[85vh]"
          title="Gestionar Categorías"
        >

            {/* List of categories */}
            <div className="mb-4 overflow-y-auto max-h-[24vh] border border-gray-100 dark:border-gray-800 rounded-md divide-y divide-gray-100 dark:divide-gray-800 p-1.5">
              {categories.length === 0 ? (
                <div className="text-center py-6 text-xs text-gray-500">
                  No hay categorías creadas.
                </div>
              ) : (
                categories.map((cat) => (
                  <div
                    key={cat.id}
                    onClick={() => handleStartEditCategory(cat)}
                    className={`flex items-center justify-between py-1.5 px-2 text-sm rounded cursor-pointer transition-colors ${
                      editingCategoryId === cat.id
                        ? 'bg-indigo-50 dark:bg-indigo-500/10 ring-1 ring-indigo-200 dark:ring-indigo-500/30'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full inline-block"
                        style={{ backgroundColor: cat.color || '#3b82f6' }}
                      />
                      <span className="font-medium text-gray-800 dark:text-gray-200">{cat.name}</span>
                    </div>
                    <IconAction
                      icon={Trash2}
                      label={`Eliminar categoría ${cat.name}`}
                      title="Eliminar Categoría"
                      size="xs"
                      className="rounded text-gray-400 hover:bg-red-50 hover:text-red-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCategory(cat.id);
                      }}
                    />
                  </div>
                ))
              )}
            </div>

            {/* Add New / Edit Category Form */}
            <form
              onSubmit={(e) => (editingCategoryId ? handleUpdateCategory(e) : handleCreateCategory(e))}
              className="space-y-4 border-t border-gray-100 dark:border-gray-800 pt-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {editingCategoryId ? 'Editar Categoría' : 'Nueva Categoría'}
                </h3>
                {editingCategoryId && (
                  <button
                    type="button"
                    onClick={() => setEditingCategoryId(null)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Cancelar edición"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div>
                <FormLabel>
                  Nombre
                </FormLabel>
                <Input
                  type="text"
                  required
                  placeholder="Ej. Bebidas, Almacén"
                  value={editingCategoryId ? editForm.name : categoryForm.name}
                  onChange={(e) =>
                    editingCategoryId
                      ? setEditForm({ ...editForm, name: e.target.value })
                      : setCategoryForm({ ...categoryForm, name: e.target.value })
                  }
                />
              </div>

              <div>
                <FormLabel>
                  Color Identificador
                </FormLabel>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    className="w-10 h-10 border border-gray-300 dark:border-gray-700 rounded-md cursor-pointer bg-transparent"
                    value={editingCategoryId ? editForm.color : categoryForm.color}
                    onChange={(e) =>
                      editingCategoryId
                        ? setEditForm({ ...editForm, color: e.target.value })
                        : setCategoryForm({ ...categoryForm, color: e.target.value })
                    }
                  />
                  <Input
                    type="text"
                    className="font-mono"
                    value={editingCategoryId ? editForm.color : categoryForm.color}
                    onChange={(e) =>
                      editingCategoryId
                        ? setEditForm({ ...editForm, color: e.target.value })
                        : setCategoryForm({ ...categoryForm, color: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                {editingCategoryId ? (
                  <Button type="button" variant="outline" onClick={() => setEditingCategoryId(null)}>
                    Cancelar
                  </Button>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setIsCategoryModalOpen(false)}>
                    Cerrar
                  </Button>
                )}
                <Button type="submit" disabled={isSubmittingCategory || isUpdatingCategory}>
                  {editingCategoryId ? (
                    isUpdatingCategory ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        Guardando...
                      </>
                    ) : (
                      'Guardar'
                    )
                  ) : (
                    isSubmittingCategory ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        Creando...
                      </>
                    ) : (
                      'Agregar'
                    )
                  )}
                </Button>
              </div>
            </form>
        </Modal>
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

      {isTransferModalOpen && (
        <NewTransferModal
          tenants={tenants || []}
          currentTenantId={tenant?.id}
          onClose={() => setIsTransferModalOpen(false)}
          onSuccess={() => {
            setIsTransferModalOpen(false);
            setTransfersTrigger(prev => prev + 1);
          }}
        />
      )}
    </div>
  );
}

function NewTransferModal({
  tenants,
  currentTenantId,
  onClose,
  onSuccess,
}: {
  tenants: { id: string; name: string }[];
  currentTenantId?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [fromTenantId, setFromTenantId] = useState(currentTenantId || '');
  const [toTenantId, setToTenantId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<{ product_id: string; product_name: string; quantity: number }[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [allProducts, setAllProducts] = useState<TransferProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const otherTenants = tenants.filter((t) => t.id !== fromTenantId);

  useEffect(() => {
    if (!fromTenantId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAllProducts([]);
      return;
    }
    const loadProducts = async () => {
      setLoadingProducts(true);
      try {
        const res = await authFetch('/api/products', {
          headers: {
            'x-active-tenant-id': fromTenantId,
          }
        });
        if (res.ok) {
          const data = await res.json();
          setAllProducts(data || []);
        }
      } catch {
        toast.error('Error al cargar los productos de la sucursal');
      } finally {
        setLoadingProducts(false);
      }
    };
    loadProducts();
  }, [fromTenantId]);

  const searchResults = React.useMemo(() => {
    if (!searchTerm.trim()) return [];
    const alreadyAdded = new Set(items.map(i => i.product_id));
    return allProducts.filter(p => {
      if (alreadyAdded.has(p.id)) return false;
      return (
        matchesQuery(p.name, searchTerm) ||
        matchesQuery(p.sku, searchTerm) ||
        matchesQuery(p.barcode, searchTerm)
      );
    }).slice(0, 8);
  }, [searchTerm, allProducts, items]);

  const addItem = (product: TransferProduct) => {
    setItems(prev => [...prev, { product_id: product.id, product_name: product.name, quantity: 1 }]);
    setSearchTerm('');
  };

  const updateQuantity = (productId: string, qty: number) => {
    setItems(prev => prev.map(i => i.product_id === productId ? { ...i, quantity: Math.max(1, qty) } : i));
  };

  const removeItem = (productId: string) => {
    setItems(prev => prev.filter(i => i.product_id !== productId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromTenantId || !toTenantId) {
      toast.error('Seleccioná origen y destino');
      return;
    }
    if (items.length === 0) {
      toast.error('Agregá al menos un producto');
      return;
    }

    setSubmitting(true);
    try {
      const res = await authFetch('/api/stock-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_tenant_id: fromTenantId,
          to_tenant_id: toTenantId,
          notes: notes || undefined,
          items: items.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al crear transferencia');
      toast.success('Transferencia creada correctamente');
      onSuccess();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al crear transferencia');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      className="max-w-2xl flex flex-col max-h-[90vh]"
      title="Nueva transferencia"
      titleClassName="mb-4 flex items-center gap-2"
      icon={<ArrowRightLeft className="h-5 w-5 text-indigo-500" />}
    >
      <form onSubmit={handleSubmit} className="space-y-5 overflow-y-auto pr-1 flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FormLabel className="mb-1.5">
                Origen
              </FormLabel>
              <Select value={fromTenantId} onChange={(e) => {
                setFromTenantId(e.target.value);
                if (e.target.value === toTenantId) setToTenantId('');
              }}>
                <option value="">Seleccionar origen...</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <FormLabel className="mb-1.5">
                Destino
              </FormLabel>
              <Select value={toTenantId} onChange={(e) => setToTenantId(e.target.value)}>
                <option value="">Seleccionar destino...</option>
                {otherTenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <FormLabel className="mb-1.5">
              Productos
            </FormLabel>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder={loadingProducts ? "Cargando catálogo de la sucursal..." : "Buscar productos por nombre, SKU o código de barras..."}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                disabled={loadingProducts || !fromTenantId}
                className="pl-9"
              />
              {loadingProducts && (
                <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-gray-400" />
              )}
            </div>

            {searchResults.length > 0 && (
              <div className="mb-3 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800 max-h-48 overflow-y-auto">
                {searchResults.map((p) => (
                  <button
                    key={p.id as string}
                    type="button"
                    onClick={() => addItem(p)}
                    className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50 text-left"
                  >
                    <span className="font-medium text-gray-900 dark:text-gray-100">{p.name as string}</span>
                    <span className="text-xs text-indigo-500 font-medium">Agregar</span>
                  </button>
                ))}
              </div>
            )}

            {items.length > 0 ? (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((item) => (
                  <div key={item.product_id} className="flex items-center justify-between px-3 py-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1">
                      {item.product_name}
                    </span>
                    <div className="flex items-center gap-2 ml-3">
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateQuantity(item.product_id, parseInt(e.target.value) || 1)}
                        className="w-20 text-center text-sm"
                      />
                      <IconAction
                        icon={X}
                        label="Quitar item"
                        size="xs"
                        className="text-gray-400 hover:text-red-500"
                        onClick={() => removeItem(item.product_id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">
                Buscá y agregá productos a la transferencia
              </p>
            )}
          </div>

          <div>
            <FormLabel className="mb-1.5">
              Notas (opcional)
            </FormLabel>
            <textarea
              className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              rows={2}
              placeholder="Motivo o comentarios sobre la transferencia..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Creando...</>
              ) : (
                'Enviar transferencia'
              )}
            </Button>
          </div>
        </form>
      </Modal>
  );
}
