'use client';

import { useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { authFetch } from '@/lib/fetchWithTenant';
import dynamicImport from 'next/dynamic';
const BarcodeScanner = dynamicImport(
  () => import('@/components/scanner/BarcodeScanner').then((m) => ({ default: m.BarcodeScanner })),
  { ssr: false }
);
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormLabel } from '@/components/ui/form-label';
import {
  Package,
  PackageMinus,
  PackagePlus,
  Pencil,
  Scan,
  ShoppingCart,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { formatARS } from '@/lib/utils/currency';
import { cn } from '@/lib/utils/cn';
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
type ScanAction = 'add' | 'remove' | 'sell';

const ADD_REASONS = [
  { value: 'found', label: 'Inventario encontrado' },
  { value: 'correction', label: 'Corrección de stock' },
];

const REMOVE_REASONS = [
  { value: 'damaged', label: 'Producto dañado' },
  { value: 'lost', label: 'Producto perdido' },
  { value: 'stolen', label: 'Producto robado' },
  { value: 'expired', label: 'Producto vencido' },
];

const ACTIONS: { value: ScanAction; label: string; icon: typeof Package }[] = [
  { value: 'add', label: 'Sumar stock', icon: PackagePlus },
  { value: 'sell', label: 'Vender', icon: ShoppingCart },
  { value: 'remove', label: 'Descontar', icon: PackageMinus },
];

export default function ScanningPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>}>
      <ScanningPageContent />
    </Suspense>
  );
}

function ScanningPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stockinMode = searchParams?.get('mode') === 'stockin';
  useAuth();

  const [scanState, setScanState] = useState<ScanState>('scanning');
  const [scannedCode, setScannedCode] = useState('');
  const [product, setProduct] = useState<ScannedProduct | null>(null);
  const [activeAction, setActiveAction] = useState<ScanAction>('add');
  const [quantity, setQuantity] = useState(1);
  const [addReason, setAddReason] = useState('found');
  const [removeReason, setRemoveReason] = useState('damaged');
  const [isSaving, setIsSaving] = useState(false);

  const handleScan = useCallback(async (code: string) => {
    setScannedCode(code);
    setScanState('scanning');

    try {
      const res = await authFetch(`/api/products/barcode/${encodeURIComponent(code)}`);
      if (!res.ok) {
        setScanState('error');
        toast.error('Error al buscar producto');
        return;
      }
      const data = await res.json();

      if (data.product) {
        setProduct(data.product);
        setActiveAction('add');
        setQuantity(1);
        setAddReason('found');
        setRemoveReason('damaged');
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
    setActiveAction('add');
    setQuantity(1);
    setAddReason('found');
    setRemoveReason('damaged');
  }, []);

  const handleAdjust = async () => {
    if (!product || quantity <= 0) return;

    setIsSaving(true);
    try {
      const isRemove = activeAction === 'remove';
      const reason = isRemove ? removeReason : addReason;
      const delta = isRemove ? -Math.abs(quantity) : Math.abs(quantity);

      const res = await authFetch(`/api/products/${product.id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: delta, reason }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al ajustar stock');

      setProduct((prev) => prev ? { ...prev, stock: data.newStock } : prev);
      toast.success(`Stock actualizado: ${data.newStock} unidades`);
      setScanState('created');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al ajustar stock');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSell = () => {
    if (!product) return;
    const stock = product.stock ?? 0;
    if (stock <= 0) {
      toast.error('No hay stock disponible para vender');
      return;
    }
    const qty = Math.min(Math.max(1, quantity), stock);
    router.push(`/sales?add=${encodeURIComponent(product.id)}&qty=${qty}`);
  };

  const availableStock = product?.stock ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        compact
        icon={
          stockinMode ? (
            <PackagePlus className="h-8 w-8 text-teal-600 dark:text-teal-400" />
          ) : (
            <Scan className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          )
        }
        title={stockinMode ? 'Carga de Inventario' : 'Escáner de Códigos'}
        subtitle={
          stockinMode
            ? 'Escaneá un producto para sumar stock, venderlo o ajustarlo.'
            : 'Apunta la cámara a un código de barras para buscar, vender o ajustar un producto.'
        }
      />

      {stockinMode && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 text-sm text-teal-700 dark:text-teal-400">
          <PackagePlus className="h-4 w-4 shrink-0" />
          Modo carga de inventario: al escanear se abre el producto con la opción de sumar stock preseleccionada.
        </div>
      )}

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
                  <p className="font-semibold text-lg">{availableStock}</p>
                </div>
                <div>
                  <span className="text-gray-500">Precio</span>
                  <p className="font-semibold text-lg text-green-600">{formatARS(product.price)}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <FormLabel>¿Qué querés hacer?</FormLabel>
                  <div className="grid grid-cols-3 gap-2">
                    {ACTIONS.map((action) => {
                      const Icon = action.icon;
                      const active = activeAction === action.value;
                      return (
                        <button
                          key={action.value}
                          type="button"
                          onClick={() => setActiveAction(action.value)}
                          aria-pressed={active}
                          className={cn(
                            'flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors',
                            active
                              ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-indigo-300'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          {action.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <FormLabel>
                    {activeAction === 'add' && 'Cantidad a sumar'}
                    {activeAction === 'remove' && 'Cantidad a descontar'}
                    {activeAction === 'sell' && 'Cantidad a vender'}
                  </FormLabel>
                  <Input
                    type="number"
                    min={1}
                    max={activeAction === 'sell' ? Math.max(1, availableStock) : undefined}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                  />
                  {activeAction === 'sell' && (
                    <p className="text-xs text-gray-500 mt-1">
                      Stock disponible: {availableStock}
                    </p>
                  )}
                </div>

                {activeAction !== 'sell' && (
                  <div>
                    <FormLabel>Motivo</FormLabel>
                    <Select
                      value={activeAction === 'remove' ? removeReason : addReason}
                      onChange={(e) => {
                        if (activeAction === 'remove') setRemoveReason(e.target.value);
                        else setAddReason(e.target.value);
                      }}
                    >
                      {(activeAction === 'remove' ? REMOVE_REASONS : ADD_REASONS).map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </Select>
                    {activeAction === 'remove' && (
                      <p className="text-xs text-amber-600 mt-1">Esta opción restará stock</p>
                    )}
                  </div>
                )}

                {activeAction === 'sell' && (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300">
                    Se va a abrir el punto de venta con este producto en el carrito.
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    className="flex items-center gap-1"
                  >
                    <Scan className="h-4 w-4" />
                    Escanear otro
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => router.push(`/products?edit=${encodeURIComponent(product.id)}`)}
                    className="flex items-center gap-1"
                  >
                    <Pencil className="h-4 w-4" />
                    Editar
                  </Button>
                  {activeAction === 'sell' ? (
                    <Button
                      onClick={handleSell}
                      disabled={availableStock <= 0 || quantity <= 0}
                      className="flex items-center gap-1"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      Vender {Math.min(quantity, Math.max(1, availableStock))}
                    </Button>
                  ) : (
                    <Button
                      onClick={handleAdjust}
                      disabled={isSaving || quantity <= 0}
                      className="flex items-center gap-1"
                    >
                      {isSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : activeAction === 'remove' ? (
                        <PackageMinus className="h-4 w-4" />
                      ) : (
                        <PackagePlus className="h-4 w-4" />
                      )}
                      {activeAction === 'remove' ? `Descontar ${quantity}` : `Sumar ${quantity}`}
                    </Button>
                  )}
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
