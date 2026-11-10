'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { useProducts } from '@/lib/hooks/useProducts';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePagination } from '@/lib/hooks/usePagination';
import { fetchWithTenant } from '@/lib/fetchWithTenant';
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
} from 'lucide-react';

const PRODUCTS_PER_PAGE = 15;
/** Cuántos QRs se generan a la vez: acotado para no congelar el hilo principal. */
const QR_CONCURRENCY = 16;

type QrModule = typeof import('qrcode');

const QR_OPTIONS = { width: 300, margin: 2, color: { dark: '#1e1e2e', light: '#ffffff' } } as const;

async function generateQr(lib: QrModule, code: string): Promise<string | null> {
  try {
    return await lib.toDataURL(code, QR_OPTIONS);
  } catch {
    return null;
  }
}

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
    const url = await generateQr(lib, code);
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
  const printRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

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

      const cards = filtered.map((p) => {
        const qrUrl = printMap.get(p.id);
        const code = p.barcode || p.sku || p.id;
        if (!qrUrl || !isSafeImageUrl(qrUrl)) return '';
        return `
          <div class="qr-card">
            <img src="${escapeAttribute(qrUrl)}" alt="QR ${escapeAttribute(p.name)}" width="120" height="120" />
            <p class="qr-name">${escapeHtml(p.name)}</p>
            <p class="qr-code">${escapeHtml(code)}</p>
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
      color: #000;
      padding: 12px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    .qr-card {
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      break-inside: avoid;
    }
    .qr-card img { width: 120px; height: 120px; }
    .qr-name {
      font-size: 11px;
      font-weight: 600;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }
    .qr-code {
      font-size: 9px;
      color: #6b7280;
      font-family: monospace;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }
    @media print {
      @page { margin: 0.5cm; }
      body { padding: 0; }
    }
  </style>
</head>
<body>
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
        subtitle="Generá códigos QR para imprimir y pegar en góndolas, bultos o productos fraccionados."
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
      <Card className="p-4 border border-gray-100 dark:border-gray-800">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <SearchInput
              ref={searchInputRef}
              placeholder="Buscar por nombre, SKU o código..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            />
          </div>
          <div>
            <Select value={selectedCategoryId} onChange={(e) => { setSelectedCategoryId(e.target.value); setCurrentPage(1); }}>
              <option value="all">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div className="flex items-center text-sm text-gray-500">
            {filtered.length} producto(s)
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
        <Card className="border border-gray-100 dark:border-gray-800">
          <div ref={printRef} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-4">
            {paginatedProducts.map((p) => {
              const qrUrl = qrs.get(p.id);
              const code = p.barcode || p.sku || p.id;
              return (
                <Card key={p.id} className="p-4 flex flex-col items-center gap-3 border border-gray-100 dark:border-gray-800">
                  {qrUrl ? (
                    <Image src={qrUrl} alt={`QR ${p.name}`} width={300} height={300} className="w-32 h-32" unoptimized />
                  ) : (
                    <div className="w-32 h-32 flex items-center justify-center text-gray-300">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  )}
                  <div className="text-center min-w-0 w-full">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate" title={p.name}>
                      {p.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate font-mono" title={code}>
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
    </div>
  );
}
