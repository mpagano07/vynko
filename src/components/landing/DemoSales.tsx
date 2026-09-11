'use client';

import { useState, useMemo } from 'react';
import { Search, ShoppingCart, Plus, Minus, Trash2, Check, Package, Tag, LayoutGrid, Receipt } from 'lucide-react';
import { formatARS } from '@/lib/utils/currency';
import { matchesQuery } from '@/lib/utils/text';
import Link from 'next/link';

interface DemoProduct {
  id: string;
  name: string;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  maxStock: number;
  sku: string;
  barcode: string;
  category: string;
  categoryColor: string;
  deposito?: string;
  pasillo?: string;
  estanteria?: string;
}

interface CartItem {
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
}

const DUMMY_PRODUCTS: DemoProduct[] = [
  { id: '1', name: 'Café Espresso 250g', price: 2800, cost: 1650, stock: 45, minStock: 10, maxStock: 60, sku: 'CAF-250', barcode: '7790001001', category: 'Bebidas', categoryColor: '#f59e0b', deposito: '1', pasillo: 'A', estanteria: '2' },
  { id: '2', name: 'Leche Entera 1L', price: 1200, cost: 750, stock: 120, minStock: 30, maxStock: 150, sku: 'LEC-1L', barcode: '7790002002', category: 'Lácteos', categoryColor: '#3b82f6', deposito: '1', pasillo: 'B', estanteria: '1' },
  { id: '3', name: 'Pan Lactal x6', price: 1500, cost: 980, stock: 30, minStock: 15, maxStock: 80, sku: 'PAN-6', barcode: '7790003003', category: 'Panadería', categoryColor: '#f97316', deposito: '2', pasillo: 'C', estanteria: '1' },
  { id: '4', name: 'Manteca 200g', price: 900, cost: 540, stock: 3, minStock: 12, maxStock: 50, sku: 'MAN-200', barcode: '7790004004', category: 'Lácteos', categoryColor: '#3b82f6', deposito: '1', pasillo: 'B', estanteria: '3' },
  { id: '5', name: 'Azúcar 1kg', price: 1100, cost: 680, stock: 80, minStock: 20, maxStock: 100, sku: 'AZU-1K', barcode: '7790005005', category: 'Almacén', categoryColor: '#10b981', deposito: '2', pasillo: 'D', estanteria: '2' },
  { id: '6', name: 'Aceite de Oliva 500ml', price: 3500, cost: 2400, stock: 22, minStock: 8, maxStock: 40, sku: 'ACE-500', barcode: '7790006006', category: 'Almacén', categoryColor: '#10b981', deposito: '2', pasillo: 'D', estanteria: '4' },
  { id: '8', name: 'Jugo de Naranja 1L', price: 1400, cost: 890, stock: 2, minStock: 10, maxStock: 45, sku: 'JUG-NR', barcode: '7790008008', category: 'Bebidas', categoryColor: '#f59e0b', deposito: '1', pasillo: 'A', estanteria: '1' },
  { id: '10', name: 'Harina 000 1kg', price: 750, cost: 410, stock: 55, minStock: 25, maxStock: 120, sku: 'HAR-000', barcode: '7790010010', category: 'Almacén', categoryColor: '#10b981', deposito: '2', pasillo: 'D', estanteria: '1' },
];

function marginPercent(price: number, cost: number): number {
  return ((price - cost) / cost) * 100;
}

export default function DemoSales() {
  const [tab, setTab] = useState<'ventas' | 'productos'>('ventas');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [saleDone, setSaleDone] = useState(false);

  const filtered = useMemo(
    () => DUMMY_PRODUCTS.filter((p) =>
      matchesQuery(p.name, search) ||
      matchesQuery(p.sku, search) ||
      matchesQuery(p.barcode, search),
    ),
    [search],
  );

  const addToCart = (product: DemoProduct) => {
    if (product.stock <= 0) return;
    setCart((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return prev;
        return prev.map((i) =>
          i.product_id === product.id
            ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.price }
            : i,
        );
      }
      return [...prev, { product_id: product.id, name: product.name, price: product.price, quantity: 1, subtotal: product.price }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.product_id !== id) return i;
          const q = i.quantity + delta;
          if (q <= 0) return null;
          return { ...i, quantity: q, subtotal: q * i.price };
        })
        .filter(Boolean) as CartItem[],
    );
  };

  const removeItem = (id: string) => setCart((prev) => prev.filter((i) => i.product_id !== id));

  const total = cart.reduce((s, i) => s + i.subtotal, 0);

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setSaleDone(true);
    setTimeout(() => { setSaleDone(false); setCart([]); }, 3000);
  };

  return (
    <div className="bg-gray-900/80 backdrop-blur-xl border border-gray-800 rounded-2xl overflow-hidden shadow-2xl">
      <div className="flex items-center gap-2 px-4 pt-3 border-b border-gray-800 bg-gray-900/50">
        <div className="w-3 h-3 rounded-full bg-red-500" />
        <div className="w-3 h-3 rounded-full bg-yellow-500" />
        <div className="w-3 h-3 rounded-full bg-green-500" />
        <span className="ml-2 text-xs text-gray-500 font-mono">Demo Interactiva — Sin login requerido</span>
        <button
          onClick={() => { setTab('ventas'); setSearch(''); }}
          className={`ml-auto flex items-center gap-1.5 px-4 py-2.5 -mb-px text-xs font-semibold border-b-2 transition-colors ${
            tab === 'ventas'
              ? 'border-cyan-400 text-cyan-400'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <Receipt className="h-3.5 w-3.5" />
          Ventas
        </button>
        <button
          onClick={() => { setTab('productos'); setSearch(''); }}
          className={`flex items-center gap-1.5 px-4 py-2.5 -mb-px text-xs font-semibold border-b-2 transition-colors ${
            tab === 'productos'
              ? 'border-cyan-400 text-cyan-400'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Productos
        </button>
      </div>

      {tab === 'ventas' ? (
        <>
          {saleDone ? (
            <div className="p-12 text-center min-h-[360px]">
              <div className="w-16 h-16 mx-auto rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-4">
                <Check className="h-8 w-8 text-green-400" />
              </div>
              <p className="text-lg font-bold text-green-400">Venta registrada</p>
              <p className="text-sm text-gray-500 mt-1">Esto es solo una demostración. El stock se actualiza al instante.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 min-h-[360px]">
              <div className="md:col-span-2 border-b md:border-b-0 md:border-r border-gray-800">
                <div className="p-3 border-b border-gray-800">
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                    <input
                      type="text"
                      placeholder="Buscar productos..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-500/50"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 max-h-[280px] overflow-y-auto">
                  {filtered.map((p) => {
                    const inCart = cart.some((i) => i.product_id === p.id);
                    const isCritical = p.stock <= p.minStock;
                    return (
                      <button
                        key={p.id}
                        onClick={() => addToCart(p)}
                        disabled={p.stock <= 0}
                        className={`text-left p-3 rounded-lg border text-sm transition-all ${
                          p.stock <= 0
                            ? 'border-gray-800 opacity-40 cursor-not-allowed'
                            : inCart
                              ? 'border-cyan-500/30 bg-cyan-500/5'
                              : 'border-gray-800 hover:border-gray-600 hover:bg-gray-800/50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[10px] font-mono ${isCritical ? 'text-amber-400' : 'text-gray-600'}`}>
                            {isCritical ? '⚠ Bajo' : `Stock: ${p.stock}`}
                          </span>
                        </div>
                        <p className="font-medium text-gray-200 text-xs leading-tight">{p.name}</p>
                        <p className="text-cyan-400 font-bold mt-1 text-sm">{formatARS(p.price)}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col">
                <div className="p-3 border-b border-gray-800 flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-cyan-400" />
                  <span className="text-sm font-semibold text-gray-200">Carrito</span>
                  {cart.length > 0 && (
                    <span className="ml-auto text-[10px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded-full font-bold">
                      {cart.length}
                    </span>
                  )}
                </div>
                <div className="flex-1 p-3 space-y-2 overflow-y-auto max-h-[200px]">
                  {cart.length === 0 ? (
                    <div className="text-center py-8 text-gray-600 text-xs">
                      <Package className="h-8 w-8 mx-auto mb-2 text-gray-700" />
                      Click en un producto para agregarlo
                    </div>
                  ) : (
                    cart.map((item) => (
                      <div key={item.product_id} className="flex items-center justify-between bg-gray-950/60 rounded-lg px-3 py-2 border border-gray-800/50">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-300 truncate">{item.name}</p>
                          <p className="text-[10px] text-gray-600">{formatARS(item.price)} x {item.quantity}</p>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <button onClick={() => updateQty(item.product_id, -1)} className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-gray-700 transition-colors">
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-5 text-center text-xs font-bold text-gray-300">{item.quantity}</span>
                          <button onClick={() => updateQty(item.product_id, 1)} className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-gray-700 transition-colors">
                            <Plus className="h-3 w-3" />
                          </button>
                          <button onClick={() => removeItem(item.product_id)} className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors ml-1">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {cart.length > 0 && (
                  <div className="p-3 border-t border-gray-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Total</span>
                      <span className="text-lg font-bold text-cyan-400">{formatARS(total)}</span>
                    </div>
                    <button
                      onClick={handleCheckout}
                      className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <Check className="h-4 w-4" />
                      Finalizar venta (demo)
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="min-h-[360px]">
          <div className="p-3 border-b border-gray-800 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
              <input
                type="text"
                placeholder="Buscar por nombre, SKU o código de barras..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-500/50"
              />
            </div>
            <span className="text-xs text-gray-500">
              {filtered.length} de {DUMMY_PRODUCTS.length} productos
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-950/40 border-b border-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4 sm:px-5">Producto</th>
                  <th className="py-3 px-3">Categoría</th>
                  <th className="py-3 px-4 sm:px-5">Ubicación</th>
                  <th className="py-3 px-4 sm:px-5">Código</th>
                  <th className="py-3 px-4 sm:px-5">Precios (Costo / Venta)</th>
                  <th className="py-3 px-4 sm:px-5 text-center">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60 text-sm">
                {filtered.map((p) => {
                  const isCritical = p.stock <= p.minStock;
                  const isLow = !isCritical && p.stock <= p.minStock * 1.5;
                  const margin = marginPercent(p.price, p.cost);
                  return (
                    <tr key={p.id} className="hover:bg-gray-800/20">
                      <td className="py-3.5 px-4 sm:px-5">
                        <p className="font-semibold text-gray-100 text-sm">{p.name}</p>
                        <p className="text-[10px] text-gray-600 font-mono">{p.sku}</p>
                      </td>
                      <td className="py-3.5 px-3">
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
                          style={{ backgroundColor: `${p.categoryColor}15`, color: p.categoryColor }}
                        >
                          <Tag className="h-3 w-3" />
                          {p.category}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 sm:px-5">
                        <div className="text-[11px] text-gray-500 leading-tight whitespace-nowrap">
                          <p>Depósito: {p.deposito}</p>
                          <p className="mt-0.5">Pasillo: {p.pasillo} · Est.: {p.estanteria}</p>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 sm:px-5">
                        <p className="text-gray-300 font-mono text-[11px]">{p.sku}</p>
                        <p className="text-[10px] text-gray-600 font-mono mt-0.5">GTIN: {p.barcode}</p>
                      </td>
                      <td className="py-3.5 px-4 sm:px-5">
                        <p className="text-[11px] text-gray-500">
                          Costo: <span className="font-medium text-gray-300">{formatARS(p.cost)}</span>
                        </p>
                        <p className="text-sm font-semibold text-green-400 mt-0.5">{formatARS(p.price)}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          Margen: <span className={`font-medium ${margin >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {margin >= 0 ? '+' : ''}{margin.toFixed(0)}%
                          </span>
                        </p>
                      </td>
                      <td className="py-3.5 px-4 sm:px-5 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full font-bold text-xs ${
                            isCritical
                              ? 'bg-red-500/15 text-red-400'
                              : isLow
                                ? 'bg-amber-500/15 text-amber-400'
                                : 'bg-emerald-500/15 text-emerald-400'
                          }`}>
                            {p.stock}
                          </span>
                          <div className="text-left text-[10px] text-gray-500">
                            <div>Ideal: {p.minStock} - {p.maxStock}</div>
                            {isCritical && <div className="text-red-400 font-semibold">Crítico</div>}
                            {isLow && <div className="text-amber-400 font-semibold">Bajo</div>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="px-4 py-3 border-t border-gray-800 bg-gray-900/30 flex items-center justify-between">
        <p className="text-[11px] text-gray-600">Productos de ejemplo — Los datos no se guardan</p>
        <Link href="/auth/signup" className="text-[11px] text-cyan-400 hover:text-cyan-300 font-medium transition-colors">
          Crear cuenta real →
        </Link>
      </div>
    </div>
  );
}