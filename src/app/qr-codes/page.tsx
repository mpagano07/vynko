'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { useProducts } from '@/lib/hooks/useProducts';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePagination } from '@/lib/hooks/usePagination';
import { fetchWithTenant } from '@/lib/fetchWithTenant';
import { generateBrandedQrDataUrl } from '@/lib/qr-branding';
import { matchesQuery } from '@/lib/utils/text';
import { escapeAttribute, escapeHtml, isSafeImageUrl } from '@/lib/security/html-escape';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { LoadingState } from '@/components/ui/loading-state';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { SearchInput } from '@/components/ui/search-input';
import {
  QrCode,
  Loader2,
  Download,
  Printer,
  Package,
  X,
} from 'lucide-react';

const PRODUCTS_PER_PAGE = 15;
/** Cuántos QRs se generan a la vez: acotado para no congelar el hilo principal. */
const QR_CONCURRENCY = 16;

type QrModule = typeof import('qrcode');

/**
 * Recorre una lista corriendo `fn` con concurrencia acotada. `Promise.all`
 * puro sobre cientos de items saturaría el hilo principal con los canvas de
 * los QR; de a tandas la UI sigue respondiendo.
 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function generateQrEntries(lib: QrModule, products: { id: string; barcode?: string | null; sku?: string | null }[]) {
  const entries = await mapWithConcurrency(products, QR_CONCURRENCY, async (p) => {
    const code = p.barcode || p.sku || p.id;
    const url = await generateBrandedQrDataUrl(lib, code);
    return url ? ([p.id, url] as [string, string]) : null;
  });
  return entries.filter((e): e is [string, string] => e !== null);
}

export default function CodigosPage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;
  const { products, isLoading, isError, mutate } = useProducts(tenantId);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [qrs, setQrs] = useState<Map<string, string>>(new Map());
  const [printing, setPrinting] = useState(false);
  const [preview, setPreview] = useState<{ id: string; name: string; code: string; qrUrl: string } | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [preview]);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      try {
        const res = await fetchWithTenant('/api/categories');
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) {
          setCategories(data.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
        }
      } catch {
        setCategories([]);
      }
    })();
  }, [tenantId]);

  // `filtered` en memo porque `usePagination` cachea su slice por identidad del
  // array: sin esto el efecto de generación se re-dispararía en cada render.
  const filtered = useMemo(
    () =>
      (products || []).filter((p) => {
        const matchesSearch = !searchTerm ||
          matchesQuery(p.name, searchTerm) ||
          matchesQuery(p.sku, searchTerm) ||
          matchesQuery(p.barcode, searchTerm);
        const matchesCat = selectedCategoryId === 'all' || p.category_id === selectedCategoryId;
        return matchesSearch && matchesCat;
      }),
    [products, searchTerm, selectedCategoryId]
  );

  const { currentPage, setCurrentPage, totalPages, pageItems: paginatedProducts } = usePagination(filtered, PRODUCTS_PER_PAGE);

  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories]
  );

  const hasFilters = searchTerm.trim().length > 0 || selectedCategoryId !== 'all';

  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setSelectedCategoryId('all');
    setCurrentPage(1);
  }, [setCurrentPage]);

  // Los QR se generan perezosamente: sólo para los productos de la página
  // visible y en tandas. Antes se generaban TODOS en serie al montar y con
  // catálogos grandes la página quedaba "Generando..." varios segundos.
  useEffect(() => {
    if (paginatedProducts.length === 0) return;
    let cancelled = false;
    (async () => {
      const QRCode = await import('qrcode');
      const entries = await generateQrEntries(QRCode, paginatedProducts);
      if (cancelled) return;
      setQrs(new Map(entries));
    })();
    return () => { cancelled = true; };
  }, [paginatedProducts]);

  // Estado de carga inicial: mientras no exista ningún QR generado y haya
  // productos para mostrar. Después, los cambios de página o filtro muestran
  // la grilla con spinners por tarjeta en lugar de bloquear toda la vista.
  const generatingInitial = qrs.size === 0 && paginatedProducts.length > 0;

  const downloadQR = useCallback((productId: string, filename: string) => {
    const url = qrs.get(productId);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.png`;
    a.click();
  }, [qrs]);

  // Imprime TODOS los filtrados (no sólo la página visible): antes de abrir
  // la ventana se generan en tandas los QR que falten, reusando los cacheados.
  const handlePrint = async () => {
    if (printing) return;
    setPrinting(true);
    try {
      const printMap = new Map(qrs);
      const missing = filtered.filter((p) => !printMap.has(p.id));
      if (missing.length > 0) {
        const QRCode = await import('qrcode');
        const entries = await generateQrEntries(QRCode, missing);
        for (const entry of entries) printMap.set(entry[0], entry[1]);
        setQrs(printMap);
      }

      const printWindow = window.open('', '_blank', 'width=800,height=600,noopener,noreferrer');
      if (!printWindow) return;
      printWindow.opener = null;

      const logoUrl = `${window.location.origin}/icons/vynkoLogout.png`;
      const printedOn = new Date().toLocaleDateString('es-AR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

      const cards = filtered.map((p) => {
        const qrUrl = printMap.get(p.id);
        const code = p.barcode || p.sku || p.id;
        if (!qrUrl || !isSafeImageUrl(qrUrl)) return '';
        return `
          <div class="qr-card">
            <div class="qr-frame">
              <img src="${escapeAttribute(qrUrl)}" alt="QR ${escapeAttribute(p.name)}" width="140" height="140" />
            </div>
            <p class="qr-name">${escapeHtml(p.name)}</p>
            <p class="qr-code">${escapeHtml(code)}</p>
            <span class="qr-brand">vynko</span>
          </div>
        `;
      }).join('');

      printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Códigos QR - Vynko</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #fff;
      color: #0f172a;
      padding: 0;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .print-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
      padding: 0 2px 10px;
      margin-bottom: 12px;
      border-bottom: 1px solid #e2e8f0;
    }
    .brand { display: flex; align-items: center; gap: 8px; }
    .brand-logo { height: 22px; width: auto; display: block; }
    .brand-divider { width: 1px; height: 16px; background: #cbd5e1; }
    .brand-title {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #64748b;
    }
    .meta { display: flex; flex-direction: column; gap: 1px; text-align: right; font-size: 9px; color: #64748b; }
    .meta strong { font-size: 10px; color: #0f172a; }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
    }
    .qr-card {
      border: 1px dashed #cbd5e1;
      border-radius: 10px;
      padding: 9px 8px 7px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      background: #fff;
      break-inside: avoid;
    }
    .qr-frame {
      background: #fff;
      padding: 4px;
      border-radius: 8px;
      box-shadow: inset 0 0 0 1px #e2e8f0;
      line-height: 0;
    }
    .qr-card img { width: 140px; height: 140px; }
    .qr-name {
      font-size: 10.5px;
      font-weight: 600;
      line-height: 1.25;
      text-align: center;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      min-height: 26px;
      max-width: 100%;
    }
    .qr-code {
      font-size: 8.5px;
      letter-spacing: 0.02em;
      color: #6b7280;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }
    .qr-brand {
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #6366f1;
    }
    @media print {
      @page { size: A4; margin: 8mm; }
      body { padding: 0; }
      .grid { gap: 7px; }
    }
  </style>
</head>
<body>
  <header class="print-header">
    <div class="brand">
      <img class="brand-logo" src="${escapeAttribute(logoUrl)}" alt="Vynko" />
      <span class="brand-divider"></span>
      <span class="brand-title">Códigos QR</span>
    </div>
    <div class="meta">
      <strong>${escapeHtml(tenant?.name || 'Etiquetas de productos')}</strong>
      <span>${filtered.length} etiqueta(s) · ${escapeHtml(printedOn)}</span>
    </div>
  </header>
  <div class="grid">${cards}</div>
</body>
</html>`);
      printWindow.document.close();

      // La ventana de impresión hereda la CSP de la pagina, asi que un <script>
      // inline con este nonce (o sin CSP) queda bloqueado. Se dispara la
      // impresion desde la ventana padre en lugar de incrustar un script.
      printWindow.focus();
      setTimeout(() => printWindow.print(), 300);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<QrCode className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />}
        title="Códigos QR"
        subtitle="Generá códigos QR con el logo de Vynko para pegar en góndolas, bultos o productos fraccionados."
        actions={
          <Button variant="outline" size="sm" onClick={handlePrint} disabled={printing} className="flex items-center gap-1.5">
            {printing ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <Printer className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="hidden md:inline">{printing ? 'Preparando...' : 'Imprimir'}</span>
          </Button>
        }
      />

      {/* Filters */}
      <Card className="rounded-xl border border-gray-200/80 p-3 shadow-sm dark:border-gray-800 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <SearchInput
              ref={searchInputRef}
              placeholder="Buscar por nombre, SKU o código..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            />
          </div>
          <div className="sm:w-56">
            <Select value={selectedCategoryId} onChange={(e) => { setSelectedCategoryId(e.target.value); setCurrentPage(1); }}>
              <option value="all">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
              <QrCode className="h-3.5 w-3.5" />
              {filtered.length} producto(s)
            </span>
            {hasFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1">
                <X className="h-3.5 w-3.5" />
                Limpiar
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* QR Grid */}
      {isError ? (
        <ErrorState title="No se pudieron cargar los productos" onRetry={() => mutate()} />
      ) : isLoading || generatingInitial ? (
        <LoadingState label="Generando códigos QR..." />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Package} title="Sin productos" description="No hay productos que coincidan con la búsqueda." />
      ) : (
        <Card className="overflow-hidden rounded-xl border border-gray-200/80 p-0 shadow-sm dark:border-gray-800">
          <div ref={printRef} className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 sm:gap-4 sm:p-4 lg:grid-cols-4 xl:grid-cols-5">
            {paginatedProducts.map((p) => {
              const qrUrl = qrs.get(p.id);
              const code = p.barcode || p.sku || p.id;
              const categoryName = p.category_id ? categoryNameById.get(p.category_id) : undefined;
              return (
                <Card
                  key={p.id}
                  className="group relative flex flex-col items-center gap-3 rounded-xl border border-gray-200/80 p-3 shadow-none transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md dark:border-gray-800 dark:hover:border-indigo-500/30 sm:p-4"
                >
                  <button
                    type="button"
                    disabled={!qrUrl}
                    onClick={() => qrUrl && setPreview({ id: p.id, name: p.name, code, qrUrl })}
                    className="relative cursor-zoom-in rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-gray-200/80 transition-all hover:ring-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-default dark:ring-gray-700 dark:hover:ring-indigo-500/50"
                    aria-label={qrUrl ? `Ampliar QR de ${p.name}` : undefined}
                    title={qrUrl ? 'Ampliar QR' : undefined}
                  >
                    {qrUrl ? (
                      <Image
                        src={qrUrl}
                        alt={`QR ${p.name}`}
                        width={360}
                        height={360}
                        className="h-28 w-28 sm:h-32 sm:w-32 md:h-40 md:w-40"
                        unoptimized
                      />
                    ) : (
                      <div className="h-28 w-28 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800 sm:h-32 sm:w-32 md:h-40 md:w-40" />
                    )}
                  </button>
                  <div className="flex w-full min-w-0 flex-1 flex-col text-center">
                    {categoryName && (
                      <p className="mb-0.5 truncate text-xs font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">
                        {categoryName}
                      </p>
                    )}
                    <p
                      className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-5 text-gray-900 dark:text-gray-100"
                      title={p.name}
                    >
                      {p.name}
                    </p>
                    <p
                      className="mt-1 w-full truncate rounded-md bg-gray-100 px-2 py-1 text-center font-mono text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                      title={code}
                    >
                      {code}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadQR(p.id, code)}
                    className="w-full flex items-center justify-center gap-1.5"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Descargar
                  </Button>
                </Card>
              );
            })}
          </div>

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        </Card>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setPreview(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`QR de ${preview.name}`}
            className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreview(null)}
              aria-label="Cerrar"
              className="absolute right-3 top-3 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex flex-col items-center gap-3">
              <Image
                src={preview.qrUrl}
                alt={`QR ${preview.name}`}
                width={360}
                height={360}
                className="h-64 w-64 rounded-xl sm:h-72 sm:w-72"
                unoptimized
              />
              <div className="w-full text-center">
                <p className="truncate text-base font-semibold text-gray-900 dark:text-gray-100" title={preview.name}>
                  {preview.name}
                </p>
                <p className="mx-auto mt-1 w-full truncate rounded-md bg-gray-100 px-2 py-1 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {preview.code}
                </p>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Apuntá la cámara al código para escanearlo.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadQR(preview.id, preview.code)}
                className="w-full gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                Descargar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
