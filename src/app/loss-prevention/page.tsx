'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useProducts } from '@/lib/hooks/useProducts';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import toast from 'react-hot-toast';
import {
  ShieldAlert, Package, TrendingDown, AlertTriangle,
  Loader2, Search, X, CalendarDays, ClipboardList, BarChart3
} from 'lucide-react';
import { formatARS } from '@/lib/utils/currency';

const reasonOptions = [
  { value: 'damaged', label: 'Dañado', color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30' },
  { value: 'lost', label: 'Perdido', color: 'text-red-600 bg-red-50 dark:bg-red-950/30' },
  { value: 'stolen', label: 'Robado', color: 'text-rose-600 bg-rose-50 dark:bg-rose-950/30' },
  { value: 'expired', label: 'Vencido', color: 'text-orange-600 bg-orange-50 dark:bg-orange-950/30' },
  { value: 'found', label: 'Encontrado', color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30' },
  { value: 'correction', label: 'Corrección', color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30' },
];

const reasonMap = Object.fromEntries(reasonOptions.map(r => [r.value, r]));

export default function LossPreventionPage() {
  const { tenant } = useAuth();
  const { products, isLoading: productsLoading } = useProducts(tenant?.id);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('adjustment');
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({ productId: '', quantity: 0, reason: 'damaged', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  const fetchHistory = async (type?: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {};
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    const typeParam = type || typeFilter;
    const url = typeParam === 'all'
      ? `/api/stock-history?days=90&limit=200`
      : `/api/stock-history?type=${typeParam}&days=90&limit=200`;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      setHistory(data.items || []);
    } else {
      const err = await res.json().catch(() => ({ error: 'Error de red' }));
      console.error('Error fetching stock history:', err.error);
      toast.error('Error al cargar historial: ' + err.error);
    }
  };

  useEffect(() => {
    if (!productsLoading) fetchHistory().finally(() => setLoading(false));
  }, [productsLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.productId) { toast.error('Seleccioná un producto'); return; }
    if (!form.quantity || form.quantity === 0) { toast.error('Ingresá una cantidad'); return; }

    const qty = form.reason === 'found' || form.reason === 'correction' ? Math.abs(form.quantity) : -Math.abs(form.quantity);

    setSubmitting(true);
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

    const res = await fetch(`/api/products/${form.productId}/adjust`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ quantity: qty, reason: form.reason, notes: form.notes }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || 'Error'); setSubmitting(false); return; }

    toast.success(`Stock ajustado: ${qty > 0 ? '+' : ''}${qty} unidades`);
    setShowForm(false);
    setForm({ productId: '', quantity: 0, reason: 'damaged', notes: '' });
    setSubmitting(false);
    fetchHistory();
  };

  const losses = history.filter((h: any) => h.quantity < 0);
  const totalLosses = losses.reduce((sum: number, h: any) => sum + Math.abs(h.quantity), 0);
  const totalValue = (() => {
    let v = 0;
    for (const h of losses) {
      const p = products?.find(p => p.id === h.productId);
      v += Math.abs(h.quantity) * (p?.cost || 0);
    }
    return v;
  })();

  const topLost: [string, number][] = Object.entries(
    losses.reduce((acc: Record<string, number>, h: any) => {
      acc[h.productName] = (acc[h.productName] || 0) + Math.abs(h.quantity);
      return acc;
    }, {} as Record<string, number>)
  ).sort(([, a], [, b]) => b - a).slice(0, 5);

  const filtered = history.filter(h =>
    !search || h.productName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <ShieldAlert className="h-8 w-8 text-rose-500" />
            Antipérdidas
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Control de mermas, ajustes de stock y prevención de pérdidas.</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4" /> Reportar ajuste
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Ajustes totales</p>
              <p className="text-2xl font-bold mt-1 text-gray-900 dark:text-white">{history.length}</p>
              <p className="text-xs text-gray-500 mt-1">Últimos 90 días</p>
            </div>
            <div className="p-2.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500"><ClipboardList className="h-5 w-5" /></div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Unidades perdidas</p>
              <p className="text-2xl font-bold mt-1 text-rose-600">{totalLosses}</p>
              <p className="text-xs text-gray-500 mt-1">{losses.length} eventos</p>
            </div>
            <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-500"><TrendingDown className="h-5 w-5" /></div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Valor estimado perdido</p>
              <p className="text-2xl font-bold mt-1 text-gray-900 dark:text-white">{formatARS(totalValue)}</p>
              <p className="text-xs text-gray-500 mt-1">Basado en costo</p>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-500"><AlertTriangle className="h-5 w-5" /></div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Producto más afectado</p>
                <p className="text-lg font-bold mt-1 text-gray-900 dark:text-white truncate">{topLost.length > 0 ? topLost[0][0] : '—'}</p>
                <p className="text-xs text-gray-500 mt-1">{topLost.length > 0 ? topLost[0][1] : 0} unidades perdidas</p>
              </div>
            <div className="p-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 text-indigo-500"><Package className="h-5 w-5" /></div>
          </div>
        </Card>
      </div>

      {/* Top Lost Table */}
      {topLost.length > 0 && (
        <Card className="p-5">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-rose-500" />
            Productos con más pérdidas
          </h2>
          <div className="space-y-2">
            {topLost.map(([name, qty]: any, i: number) => (
              <div key={name} className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-400 w-5">{i + 1}</span>
                <div className="flex-1 h-8 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-rose-400 dark:bg-rose-600 rounded-full flex items-center px-3"
                    style={{ width: `${Math.min((qty / topLost[0][1]) * 100, 100)}%` }}
                  >
                    <span className="text-xs font-semibold text-white truncate">{name}</span>
                  </div>
                </div>
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 w-16 text-right">{qty} u.</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* History */}
      <Card className="overflow-hidden border border-gray-100 dark:border-gray-800 p-0">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input placeholder="Buscar por producto..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="w-full sm:w-44">
            <Select value={typeFilter} onChange={(e) => {
              setTypeFilter(e.target.value);
              fetchHistory(e.target.value);
            }}>
              <option value="adjustment">Ajustes</option>
              <option value="all">Todo el historial</option>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-indigo-500 mb-3" /><p className="text-sm text-gray-500">Cargando...</p></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <ShieldAlert className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-lg font-medium text-gray-900 dark:text-gray-100">Sin ajustes registrados</p>
            <p className="text-sm text-gray-500 mt-1">Los ajustes de stock aparecerán aquí.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {filtered.map((h: any) => {
              const reasonInfo = reasonMap[h.reason?.split(':')[0]] || reasonMap.correction;
              return (
                <div key={h.id} className="flex items-center gap-4 px-6 py-3.5 text-sm hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${h.quantity < 0 ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-gray-100">{h.productName}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${reasonInfo?.color || 'text-gray-500 bg-gray-100'}`}>
                        {reasonInfo?.label || h.reason}
                      </span>
                      {h.productSku && <span className="text-[10px] text-gray-400">SKU: {h.productSku}</span>}
                    </div>
                    {h.reason?.includes(':') && (
                      <p className="text-xs text-gray-500 mt-0.5">{h.reason.split(':').slice(1).join(':').trim()}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400">
                      <CalendarDays className="h-3 w-3" />
                      {new Date(h.createdAt).toLocaleDateString('es-AR', { dateStyle: 'medium' })}
                      <span>por {h.createdBy}</span>
                    </div>
                  </div>
                  <div className={`text-right font-bold text-sm ${h.quantity < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {h.quantity > 0 ? '+' : ''}{h.quantity}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Report Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs">
          <Card className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 relative">
            <button onClick={() => setShowForm(false)} className="absolute right-4 top-4 p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Reportar ajuste de stock</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Producto *</label>
                <Select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                  <option value="">Seleccionar producto...</option>
                  {(products || []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} (stock: {p.stock})</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Tipo de ajuste *</label>
                <Select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                  {reasonOptions.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Cantidad *</label>
                <Input
                  type="number"
                  min={1}
                  required
                  placeholder="Ej. 5"
                  value={form.quantity || ''}
                  onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  {form.reason === 'found' || form.reason === 'correction'
                    ? 'Se sumará al stock actual'
                    : 'Se restará del stock actual'}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Notas (opcional)</label>
                <textarea
                  className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  rows={2}
                  placeholder="Detalles adicionales..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                <Button type="submit" disabled={submitting}>{submitting ? 'Guardando...' : 'Guardar ajuste'}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
