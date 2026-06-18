'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/hooks/useAuth';
import { BarcodeScanner } from '@/components/scanner/BarcodeScanner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Package, Scan, ExternalLink, Plus, Loader2, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface ScannedProduct {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  price: number;
  cost?: number;
  stock?: number;
  min_stock?: number;
  description?: string;
}

type ScanState = 'scanning' | 'found' | 'not_found' | 'creating' | 'created' | 'error';

export default function ScanningPage() {
  const router = useRouter();
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;

  const [scanState, setScanState] = useState<ScanState>('scanning');
  const [scannedCode, setScannedCode] = useState('');
  const [product, setProduct] = useState<ScannedProduct | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    price: 0,
    cost: 0,
    stock: 0,
    min_stock: 5,
    sku: '',
  });

  const handleScan = useCallback(async (code: string) => {
    setScannedCode(code);
    setScanState('scanning');

    try {
      const res = await fetch(`/api/products/barcode/${encodeURIComponent(code)}`);
      const data = await res.json();

      if (data.product) {
        setProduct(data.product);
        setScanState('found');
      } else {
        setProduct(null);
        setScanState('not_found');
        setForm((prev) => ({ ...prev, sku: code }));
      }
    } catch {
      setScanState('error');
      toast.error('Error al buscar producto');
    }
  }, []);

  const handleReset = useCallback(() => {
    setScanState('scanning');
    setScannedCode('');
    setProduct(null);
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) {
      toast.error('El nombre del producto es requerido');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          ...form,
          barcode: scannedCode,
          price: Number(form.price),
          cost: Number(form.cost),
          stock: Number(form.stock),
          min_stock: Number(form.min_stock),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al crear producto');

      setProduct(data);
      setScanState('created');
      toast.success('Producto creado');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al crear producto');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Scan className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            Escáner de Códigos
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Apunta la cámara a un código de barras para buscar o registrar un producto.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="overflow-hidden p-0">
          <BarcodeScanner
            onResult={handleScan}
            onError={(err) => toast.error(err)}
            className="aspect-[4/3] w-full"
          />
          {scanState === 'scanning' && scannedCode && (
            <div className="flex items-center justify-center gap-2 p-3 border-t border-gray-100 dark:border-gray-800">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-sm text-gray-500">
                Buscando código: <strong>{scannedCode}</strong>
              </span>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          {scanState === 'scanning' && !scannedCode && (
            <Card className="p-8 text-center">
              <Scan className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600 mb-3" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Escanea un código
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Apunta la cámara a un código de barras para buscar el producto en tu inventario.
              </p>
            </Card>
          )}

          {scanState === 'found' && product && (
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Producto encontrado
                </h2>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Nombre</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{product.name}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">SKU</p>
                    <p className="text-sm font-mono">{product.sku || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Código</p>
                    <p className="text-sm font-mono">{product.barcode || '—'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Precio</p>
                    <p className="text-sm font-semibold text-green-600">${product.price}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Stock</p>
                    <p className="text-sm font-semibold">{(product.stock ?? 0)}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => router.push(`/products`)}
                  className="flex items-center gap-1"
                >
                  <ExternalLink className="h-4 w-4" />
                  Ir a Productos
                </Button>
                <Button onClick={handleReset}>
                  <Scan className="h-4 w-4 mr-1" />
                  Escanear otro
                </Button>
              </div>
            </Card>
          )}

          {scanState === 'not_found' && (
            <Card className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Producto no encontrado
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  No hay un producto registrado con el código <strong>{scannedCode}</strong>.
                </p>
              </div>

              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Nombre del producto *
                  </label>
                  <Input
                    type="text"
                    required
                    placeholder="Ej. Leche Entera 1L"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      SKU
                    </label>
                    <Input
                      type="text"
                      placeholder="Ej. LEC-001"
                      value={form.sku}
                      onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Stock inicial
                    </label>
                    <Input
                      type="number"
                      value={form.stock}
                      onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Costo ($)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.cost || ''}
                      onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })}
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
                      value={form.price || ''}
                      onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Stock mínimo
                    </label>
                    <Input
                      type="number"
                      value={form.min_stock}
                      onChange={(e) => setForm({ ...form, min_stock: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleReset}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        Creando...
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-1" />
                        Crear producto
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {scanState === 'created' && product && (
            <Card className="p-6 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-500 mb-3" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
                Producto creado
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                {product.name} fue registrado con el código {scannedCode}.
              </p>
              <div className="flex justify-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => router.push('/products')}
                >
                  <Package className="h-4 w-4 mr-1" />
                  Ir a productos
                </Button>
                <Button onClick={handleReset}>
                  <Scan className="h-4 w-4 mr-1" />
                  Escanear otro
                </Button>
              </div>
            </Card>
          )}

          {scanState === 'error' && (
            <Card className="p-6 text-center">
              <p className="text-sm text-red-500 mb-3">Error al buscar el producto</p>
              <Button onClick={handleReset}>
                <Scan className="h-4 w-4 mr-1" />
                Intentar de nuevo
              </Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
