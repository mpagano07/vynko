'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { useProducts } from '@/lib/hooks/useProducts';
import { useAuth } from '@/lib/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  QrCode,
  Search,
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
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  const printRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .order('name');
      if (data) setCategories(data);
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
    const q = searchTerm.toLowerCase();
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q);
    const matchesCat = selectedCategoryId === 'all' || p.category_id === selectedCategoryId;
    return matchesSearch && matchesCat;
  });

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginatedProducts = filtered.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const downloadQR = useCallback((productId: string, filename: string) => {
    const url = qrs.get(productId);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.png`;
    a.click();
  }, [qrs]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <QrCode className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
            Códigos QR
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Generá códigos QR para imprimir y pegar en góndolas, bultos o productos fraccionados.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint} className="flex items-center gap-1.5">
            <Printer className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">Imprimir</span>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4 border border-gray-100 dark:border-gray-800">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Buscar por nombre, SKU o código..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="pl-9"
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
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
          <p className="text-sm text-gray-500">Generando códigos QR...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Package className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-lg font-medium text-gray-900 dark:text-gray-100">Sin productos</p>
          <p className="text-sm text-gray-500 mt-1">No hay productos que coincidan con la búsqueda.</p>
        </div>
      ) : (
        <Card className="border border-gray-100 dark:border-gray-800 print:border-none print:shadow-none">
          <div ref={printRef} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 p-4 print:grid-cols-4">
            {paginatedProducts.map((p) => {
              const qrUrl = qrs.get(p.id);
              const code = p.barcode || p.sku || p.id;
              return (
                <Card key={p.id} className="p-4 flex flex-col items-center gap-3 border border-gray-100 dark:border-gray-800 print:border print:border-gray-300 print:shadow-none print:break-inside-avoid">
                  {qrUrl ? (
                    <Image src={qrUrl} alt={`QR ${p.name}`} width={300} height={300} className="w-32 h-32 print:w-28 print:h-28" unoptimized />
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
                    className="w-full flex items-center justify-center gap-1.5 print:hidden"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Descargar
                  </Button>
                </Card>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800 px-6 py-4 print:hidden">
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
      )}

      <style>{`
        @media print {
          body { background: white; }
          @page { margin: 0.5cm; }
        }
      `}</style>
    </div>
  );
}
