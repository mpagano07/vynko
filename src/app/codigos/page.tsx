'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { useProducts } from '@/lib/hooks/useProducts';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePagination } from '@/lib/hooks/usePagination';
import { fetchWithTenant } from '@/lib/fetchWithTenant';
import { matchesQuery } from '@/lib/utils/text';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { LoadingState } from '@/components/ui/loading-state';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import {
  QrCode,
  Loader2,
  Download,
  Printer,
  Package,
} from 'lucide-react';

export default function CodigosPage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;
  const { products, isLoading } = useProducts(tenantId);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [qrs, setQrs] = useState<Map<string, string>>(new Map());
  const [generating, setGenerating] = useState(true);
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

  useEffect(() => {
    if (!products || products.length === 0) return;
    const gen = async () => {
      const QRCode = await import('qrcode');
      const map = new Map<string, string>();
      for (const p of products) {
        const code = p.barcode || p.sku || p.id;
        try {
          const url = await QRCode.toDataURL(code, { width: 300, margin: 2, color: { dark: '#1e1e2e', light: '#ffffff' } });
          map.set(p.id, url);
        } catch { /* skip */ }
      }
      setQrs(map);
      setGenerating(false);
    };
    gen();
  }, [products]);

  const filtered = (products || []).filter((p) => {
    const matchesSearch = !searchTerm ||
      matchesQuery(p.name, searchTerm) ||
      matchesQuery(p.sku, searchTerm) ||
      matchesQuery(p.barcode, searchTerm);
    const matchesCat = selectedCategoryId === 'all' || p.category_id === selectedCategoryId;
    return matchesSearch && matchesCat;
  });

  const { currentPage, setCurrentPage, totalPages, pageItems: paginatedProducts } = usePagination(filtered, 15);

  const downloadQR = useCallback((productId: string, filename: string) => {
    const url = qrs.get(productId);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.png`;
    a.click();
  }, [qrs]);

  const handlePrint = () => {
    const cards = filtered.map((p) => {
      const qrUrl = qrs.get(p.id);
      const code = p.barcode || p.sku || p.id;
      if (!qrUrl) return '';
      return `
        <div class="qr-card">
          <img src="${qrUrl}" alt="QR ${p.name}" width="120" height="120" />
          <p class="qr-name">${p.name.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
          <p class="qr-code">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
        </div>
      `;
    }).join('');

    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) return;

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
  <script>
    window.onafterprint = function() { window.close(); };
    setTimeout(function() { window.print(); }, 300);
  <\/script>
</body>
</html>`);
    printWindow.document.close();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<QrCode className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />}
        title="Códigos QR"
        subtitle="Generá códigos QR para imprimir y pegar en góndolas, bultos o productos fraccionados."
        actions={
          <Button variant="outline" size="sm" onClick={handlePrint} className="flex items-center gap-1.5">
            <Printer className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">Imprimir</span>
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
      {isLoading || generating ? (
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
