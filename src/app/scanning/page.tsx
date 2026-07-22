'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/hooks/useAuth';
import { BarcodeScanner } from '@/components/scanner/BarcodeScanner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Package, Scan, Plus, Loader2, CheckCircle2 } from 'lucide-react';
import { formatARS } from '@/lib/utils/currency';
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

const STOCK_REASONS = [
  { value: 'found', label: 'Inventario encontrado' },
  { value: 'correction', label: 'Corrección de stock' },
  { value: 'damaged', label: 'Producto dañado (restar)' },
  { value: 'lost', label: 'Producto perdido (restar)' },
] as const;

export default function ScanningPage() {
  const router = useRouter();
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;

  const [scanState, setScanState] = useState<ScanState>('scanning');
  const [scannedCode, setScannedCode] = useState('');
  const [product, setProduct] = useState<ScannedProduct | null>(null);
  const [addQuantity, setAddQuantity] = useState(1);
  const [addReason, setAddReason] = useState('found');
  const [isAddingStock, setIsAddingStock] = useState(false);

  const handleScan = useCallback(async (code: string) => {
    setScannedCode(code);
    setScanState('scanning');

    try {
      const res = await fetch(`/api/products/barcode/${encodeURIComponent(code)}`);
      const data = await res.json();

      if (data.product) {
        setProduct(data.product);
        setAddQuantity(1);
        setAddReason('found');
        setScanState('found');
      } else {
        setScanState('not_found');
        router.push(`/products?create=1&barcode=${encodeURIComponent(code)}`);
      }
    } catch {
      setScanState('error');
      toast.error('Error al buscar producto');
    }
  }, [router]);

  const handleReset = useCallback(() => {
    setScanState('scanning');
    setScannedCode('');
    setProduct(null);
    setAddQuantity(1);
  }, []);

  const handleAddStock = async () => {
    if (!product || addQuantity <= 0) return;

    setIsAddingStock(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const quantity = addReason === 'damaged' || addReason === 'lost' ? -Math.abs(addQuantity) : addQuantity;

      const res = await fetch(`/api/products/${product.id}/adjust`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ quantity, reason: addReason }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al ajustar stock');

      setProduct((prev) => prev ? { ...prev, stock: data.newStock } : prev);
      toast.success(`Stock actualizado: ${data.newStock} unidades`);
      setScanState('created');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al ajustar stock');
    } finally {
      setIsAddingStock(false);
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
                  {product.name}
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm">
                <div>
                  <span className="text-gray-500">Stock actual</span>
                  <p className="font-semibold text-lg">{product.stock ?? 0}</p>
                </div>
                <div>
                  <span className="text-gray-500">Precio</span>
                  <p className="font-semibold text-lg text-green-600">{formatARS(product.price)}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Cantidad a ajustar
                  </label>
                  <Input
                    type="number"
                    min={1}
                    value={addQuantity}
                    onChange={(e) => setAddQuantity(Math.max(1, Number(e.target.value)))}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Motivo
                  </label>
                  <select
                    value={addReason}
                    onChange={(e) => setAddReason(e.target.value)}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                  >
                    {STOCK_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  {(addReason === 'damaged' || addReason === 'lost') && (
                    <p className="text-xs text-amber-600 mt-1">Esta opción restará stock</p>
                  )}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    className="flex items-center gap-1"
                  >
                    <Scan className="h-4 w-4" />
                    Escanear otro
                  </Button>
                  <Button
                    onClick={handleAddStock}
                    disabled={isAddingStock || addQuantity <= 0}
                    className="flex items-center gap-1"
                  >
                    {isAddingStock ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Package className="h-4 w-4" />
                    )}
                    {addReason === 'damaged' || addReason === 'lost'
                      ? `Quitar ${addQuantity}`
                      : `Agregar ${addQuantity}`
                    }
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {scanState === 'created' && product && (
            <Card className="p-6 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-500 mb-3" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
                Stock actualizado
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                <strong>{product.name}</strong> — Stock actual: <strong>{product.stock}</strong>
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
