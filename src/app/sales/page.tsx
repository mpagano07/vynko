'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { BarcodeScanner } from '@/components/scanner/BarcodeScanner';
import toast from 'react-hot-toast';
import {
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  Search,
  User,
  Loader2,
  Receipt,
  Package,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Scan,
  X,
} from 'lucide-react';
import { formatARS } from '@/lib/utils/currency';
import type { Customer } from '@/lib/types/sale';

interface CartItem {
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
  stock: number;
}

interface ProductOption {
  id: string;
  name: string;
  price: number;
  stock: number;
  barcode?: string;
  sku?: string;
}

interface SaleRecord {
  id: string;
  total_cents: number;
  customer_name?: string;
  created_at: string;
  items: { product_name?: string; quantity: number; subtotal_cents: number }[];
}

export default function SalesPage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesPage, setSalesPage] = useState(1);
  const SALES_PER_PAGE = 15;
  const [loadingData, setLoadingData] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSalesList, setShowSalesList] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [productPage, setProductPage] = useState(1);
  const PRODUCTS_PER_PAGE = 12;
  const [flyAnim, setFlyAnim] = useState<{
    id: string;
    name: string;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  } | null>(null);
  const cartRef = useRef<HTMLDivElement>(null);
  const [showScanner, setShowScanner] = useState(false);

  const fetchSales = async (page: number, headers: Record<string, string>) => {
    const res = await fetch(`/api/sales?days=15&page=${page}&limit=${SALES_PER_PAGE}`, { headers });
    if (res.ok) {
      const d = await res.json();
      setSales(d.data ?? []);
      setSalesTotal(d.total ?? 0);
    }
  };

  useEffect(() => {
    if (!tenantId || loadingData) return;
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
      await fetchSales(salesPage, headers);
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [salesPage, tenantId, loadingData]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = {
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };

      const [prodRes, custRes] = await Promise.all([
        fetch('/api/products', { headers }),
        fetch('/api/customers', { headers }),
      ]);

      if (cancelled) return;
      if (prodRes.ok) setProducts(await prodRes.json());
      if (custRes.ok) setCustomers(await custRes.json());

      await fetchSales(salesPage, headers);
    })().catch((err) => {
      console.error('Error loading data:', err);
    }).finally(() => {
      if (!cancelled) setLoadingData(false);
    });

    return () => { cancelled = true; };
  }, [tenantId]);

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.barcode && p.barcode.includes(productSearch)) ||
      (p.sku && p.sku.toLowerCase().includes(productSearch.toLowerCase()))
  );

  const totalProductPages = Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE);
  const paginatedProducts = filteredProducts.slice(
    (productPage - 1) * PRODUCTS_PER_PAGE,
    productPage * PRODUCTS_PER_PAGE
  );

  const addToCart = (product: ProductOption) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product_id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          toast.error(`Stock insuficiente para "${product.name}"`);
          return prev;
        }
        return prev.map((item) =>
          item.product_id === product.id
            ? {
                ...item,
                quantity: item.quantity + 1,
                subtotal: (item.quantity + 1) * item.price,
              }
            : item
        );
      }
      if (product.stock <= 0) {
        toast.error(`"${product.name}" no tiene stock disponible`);
        return prev;
      }
      return [
        ...prev,
        {
          product_id: product.id,
          name: product.name,
          price: product.price,
          quantity: 1,
          subtotal: product.price,
          stock: product.stock,
        },
      ];
    });
  };

  const handleAddToCart = (product: ProductOption, e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = e.currentTarget;
    const btnRect = btn.getBoundingClientRect();
    const cartEl = cartRef.current;
    const cartRect = cartEl?.getBoundingClientRect();

    if (cartRect) {
      setFlyAnim({
        id: product.id,
        name: product.name,
        fromX: btnRect.left + btnRect.width / 2,
        fromY: btnRect.top + btnRect.height / 2,
        toX: cartRect.left + cartRect.width / 2,
        toY: cartRect.top + cartRect.height / 2,
      });
      setTimeout(() => setFlyAnim(null), 600);
    }

    addToCart(product);
  };

  const handleScanBarcode = async (code: string) => {
    try {
      const res = await fetch(`/api/products/barcode/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (data.product) {
        const p = data.product;
        const productOption: ProductOption = {
          id: p.id,
          name: p.name,
          price: p.price,
          stock: p.stock ?? 0,
          barcode: p.barcode,
          sku: p.sku,
        };
        addToCart(productOption);
        toast.success(`"${p.name}" agregado al carrito`);
      } else {
        toast.error(`Código "${code}" no encontrado en productos`);
      }
    } catch {
      toast.error('Error al buscar el producto escaneado');
    }
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product_id !== productId) return item;
          const newQty = item.quantity + delta;
          if (newQty <= 0) return null;
          if (newQty > item.stock) {
            toast.error(`Stock insuficiente para "${item.name}"`);
            return item;
          }
          return { ...item, quantity: newQty, subtotal: newQty * item.price };
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product_id !== productId));
  };

  const total = cart.reduce((sum, item) => sum + item.subtotal, 0);

  const handleCheckout = async () => {
    if (cart.length === 0) {
      toast.error('Agrega al menos un producto a la venta');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          customer_id: selectedCustomerId || null,
          notes: notes || null,
          items: cart.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.price,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al registrar la venta');

      toast.success('Venta registrada exitosamente');
      setCart([]);
      setNotes('');
      setSelectedCustomerId('');

      const { data: { session: s2 } } = await supabase.auth.getSession();
      const h2 = {
        ...(s2?.access_token ? { Authorization: `Bearer ${s2.access_token}` } : {}),
      };
      const [pRes, cRes] = await Promise.all([
        fetch('/api/products', { headers: h2 }),
        fetch('/api/customers', { headers: h2 }),
      ]);
      if (pRes.ok) setProducts(await pRes.json());
      if (cRes.ok) setCustomers(await cRes.json());
      setSalesPage(1);
      await fetchSales(1, h2);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar la venta');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!tenantId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 relative">
      {flyAnim && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{
            left: flyAnim.fromX,
            top: flyAnim.fromY,
            transform: 'translate(-50%, -50%)',
            animation: 'flyToCart 0.55s cubic-bezier(0.2,1,0.3,1) forwards',
            '--fly-dx': `${flyAnim.toX - flyAnim.fromX}px`,
            '--fly-dy': `${flyAnim.toY - flyAnim.fromY}px`,
          } as React.CSSProperties}
        >
          <div className="bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg whitespace-nowrap">
            {flyAnim.name}
          </div>
        </div>
      )}
      <style>{`
        @keyframes flyToCart {
          0% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
          70% {
            opacity: 0.8;
            transform: translate(calc(-50% + var(--fly-dx) * 0.85), calc(-50% + var(--fly-dy) * 0.85)) scale(0.5);
          }
          100% {
            opacity: 0;
            transform: translate(calc(-50% + var(--fly-dx)), calc(-50% + var(--fly-dy))) scale(0.15);
          }
        }
      `}</style>
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <ShoppingCart className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
          Registrar Venta
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Busca productos, arma el carrito y confirma la venta.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4 border border-gray-100 dark:border-gray-800">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Buscar producto por nombre, SKU o código de barras..."
                  value={productSearch}
                  onChange={(e) => { setProductSearch(e.target.value); setProductPage(1); }}
                  className="pl-9"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => setShowScanner(true)}
                className="flex items-center gap-1.5 shrink-0"
              >
                <Scan className="h-4 w-4" />
                Scanner
              </Button>
            </div>
          </Card>

          {loadingData ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <Card className="p-8 text-center border border-gray-100 dark:border-gray-800">
              <Package className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-gray-500">No se encontraron productos</p>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 px-1">
                <span>
                  Mostrando {((productPage - 1) * PRODUCTS_PER_PAGE) + 1}–{Math.min(productPage * PRODUCTS_PER_PAGE, filteredProducts.length)} de {filteredProducts.length} productos
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {paginatedProducts.map((product) => {
                const inCart = cart.some((item) => item.product_id === product.id);
                return (
                  <button
                    key={product.id}
                    onClick={(e) => handleAddToCart(product, e)}
                    disabled={product.stock <= 0}
                    className={`relative text-left p-4 rounded-lg border transition-all ${
                      product.stock <= 0
                        ? 'border-gray-200 dark:border-gray-700 opacity-50 cursor-not-allowed'
                        : inCart
                          ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 shadow-sm'
                          : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm bg-white dark:bg-gray-900'
                    }`}
                  >
                    {inCart && (
                      <div className="absolute top-2 right-2 flex items-center gap-1 bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        <Check className="h-2.5 w-2.5" />
                        Agregado
                      </div>
                    )}
                    <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                      {product.name}
                    </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                      {formatARS(product.price)}
                    </span>
                    <span className={`text-xs ${product.stock <= (product.stock > 5 ? 5 : 0) ? 'text-red-500' : 'text-gray-400'}`}>
                      Stock: {product.stock}
                    </span>
                  </div>
                  {(product.barcode || product.sku) && (
                    <div className="text-[10px] text-gray-400 font-mono mt-1">
                      {product.barcode || product.sku}
                    </div>
                  )}
                </button>
              );
              })}
              </div>
              {totalProductPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => setProductPage((p) => Math.max(1, p - 1))}
                    disabled={productPage === 1}
                    className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </button>
                  <span className="text-xs text-gray-400">
                    Página {productPage} de {totalProductPages}
                  </span>
                  <button
                    onClick={() => setProductPage((p) => Math.min(totalProductPages, p + 1))}
                    disabled={productPage === totalProductPages}
                    className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Siguiente
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="space-y-4">
          <Card ref={cartRef} className="p-4 border border-gray-100 dark:border-gray-800">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4">
              <Receipt className="h-5 w-5 text-indigo-600" />
              Carrito
              {cart.length > 0 && (
                <span className="ml-auto text-sm font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 rounded-full">
                  {cart.length} productos
                </span>
              )}
            </h2>

            <div className="mb-4">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-gray-400" />
                <Select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="flex-1"
                >
                  <option value="">Cliente general (mostrador)</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {cart.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">
                <ShoppingCart className="h-12 w-12 mx-auto mb-3 text-indigo-300 dark:text-indigo-600" />
                <p className="font-medium text-gray-500 dark:text-gray-400">
                  Buscá un producto
                </p>
                <p className="text-gray-400 dark:text-gray-500">
                  o escaneá un código
                </p>
                <p className="text-gray-400 dark:text-gray-500">
                  para comenzar una venta.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {cart.map((item) => (
                  <div
                    key={item.product_id}
                    className="flex items-center justify-between p-2 rounded-lg bg-gray-100 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {item.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatARS(item.price)} x {item.quantity}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        onClick={() => updateQuantity(item.product_id, -1)}
                        className="p-2 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-6 text-center text-sm font-medium text-gray-900 dark:text-gray-100">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.product_id, 1)}
                        className="p-2 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => removeFromCart(item.product_id)}
                        className="p-2 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 ml-1"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {cart.length > 0 && (
              <>
                <div className="border-t border-gray-100 dark:border-gray-800 mt-4 pt-4 space-y-3">
                  <textarea
                    className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    rows={2}
                    placeholder="Notas (opcional)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />

                  <div className="flex items-center justify-between text-lg font-bold text-gray-900 dark:text-gray-100">
                    <span>Total</span>
                    <span className="text-2xl text-indigo-600 dark:text-indigo-400">
                      {formatARS(total)}
                    </span>
                  </div>

                  <Button
                    onClick={handleCheckout}
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Procesando...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4" />
                        Finalizar venta
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      <Card className="border border-gray-100 dark:border-gray-800">
        <button
          onClick={() => setShowSalesList(!showSalesList)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Receipt className="h-5 w-5 text-indigo-600" />
            Últimas Ventas
          </h2>
          <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">Últimos 15 días</span>
          {showSalesList ? (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          )}
        </button>

        {showSalesList && (
          <div className="border-t border-gray-100 dark:border-gray-800">
            {loadingData ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
              </div>
            ) : sales.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                No hay ventas registradas
              </div>
            ) : (
              <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <th className="py-3 px-4">Folio</th>
                      <th className="py-3 px-4">Cliente</th>
                      <th className="py-3 px-4">Productos</th>
                      <th className="py-3 px-4 text-right">Total</th>
                      <th className="py-3 px-4 text-right">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                    {sales.map((sale) => (
                      <tr key={sale.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                        <td className="py-3 px-4 font-mono text-xs text-gray-500">
                          #{sale.id.slice(0, 8)}
                        </td>
                        <td className="py-3 px-4 text-gray-900 dark:text-gray-100">
                          {sale.customer_name || 'Mostrador'}
                        </td>
                        <td className="py-3 px-4 text-gray-500 text-xs">
                          {sale.items?.length || 0} item(s)
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-green-600 dark:text-green-400">
                          {formatARS(sale.total_cents / 100)}
                        </td>
                        <td className="py-3 px-4 text-right text-xs text-gray-500">
                          {new Date(sale.created_at).toLocaleDateString('es-ES', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {Math.ceil(salesTotal / SALES_PER_PAGE) > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                  <span className="text-xs text-gray-400">
                    Mostrando {((salesPage - 1) * SALES_PER_PAGE) + 1}–{Math.min(salesPage * SALES_PER_PAGE, salesTotal)} de {salesTotal} ventas
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSalesPage((p) => Math.max(1, p - 1))}
                      disabled={salesPage === 1}
                      className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Anterior
                    </button>
                    <span className="text-xs text-gray-400">
                      Página {salesPage} de {Math.ceil(salesTotal / SALES_PER_PAGE)}
                    </span>
                    <button
                      onClick={() => setSalesPage((p) => Math.min(Math.ceil(salesTotal / SALES_PER_PAGE), p + 1))}
                      disabled={salesPage >= Math.ceil(salesTotal / SALES_PER_PAGE)}
                      className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Siguiente
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
              </>
            )}
          </div>
        )}
      </Card>

      {showScanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Scan className="h-5 w-5 text-indigo-600" />
                Escanear producto
              </h3>
              <button
                onClick={() => setShowScanner(false)}
                className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4">
              <BarcodeScanner
                onResult={handleScanBarcode}
                onError={(err) => toast.error(err)}
                className="aspect-[4/3] w-full"
              />
              <p className="text-xs text-gray-400 text-center mt-3">
                Apunta la cámara al código de barras del producto
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
