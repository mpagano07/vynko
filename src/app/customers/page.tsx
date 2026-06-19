'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Search, Plus, Edit, Trash2, Users, X, Loader2, ShoppingBag, DollarSign, CalendarDays } from 'lucide-react';
import toast from 'react-hot-toast';

interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  created_at?: string;
}

interface CustomerHistory {
  sales: any[];
  totalSpent: number;
  visitCount: number;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '' });
  const [submitting, setSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  const [historyTarget, setHistoryTarget] = useState<Customer | null>(null);
  const [historyData, setHistoryData] = useState<CustomerHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchCustomers = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/customers', {
      headers: session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {},
    });
    if (res.ok) setCustomers(await res.json());
  };

  useEffect(() => { fetchCustomers().finally(() => setLoading(false)); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', email: '', phone: '', address: '' });
    setModalOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm({ name: c.name, email: c.email || '', phone: c.phone || '', address: c.address || '' });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('El nombre es requerido'); return; }
    setSubmitting(true);
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

    const url = editing ? `/api/customers/${editing.id}` : '/api/customers';
    const method = editing ? 'PATCH' : 'POST';
    const res = await fetch(url, { method, headers, body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || 'Error al guardar'); setSubmitting(false); return; }

    toast.success(editing ? 'Cliente actualizado' : 'Cliente creado');
    setModalOpen(false);
    setSubmitting(false);
    fetchCustomers();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {};
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    const res = await fetch(`/api/customers/${deleteTarget.id}`, { method: 'DELETE', headers });
    if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Error al eliminar'); return; }
    toast.success('Cliente eliminado');
    setDeleteTarget(null);
    fetchCustomers();
  };

  const openHistory = async (c: Customer) => {
    setHistoryTarget(c);
    setHistoryLoading(true);
    setHistoryData(null);
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {};
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    const res = await fetch(`/api/customers/${c.id}/history`, { headers });
    if (res.ok) setHistoryData(await res.json());
    setHistoryLoading(false);
  };

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Users className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
            Clientes
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Gestiona tus clientes y consulta su historial de compras.</p>
        </div>
        <Button onClick={openCreate} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nuevo Cliente
        </Button>
      </div>

      <Card className="p-4 border border-gray-100 dark:border-gray-800">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input placeholder="Buscar por nombre, email o teléfono..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </Card>

      <Card className="overflow-hidden border border-gray-100 dark:border-gray-800 p-0">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
            <p className="text-sm text-gray-500">Cargando clientes...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Users className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-lg font-medium text-gray-900 dark:text-gray-100">No se encontraron clientes</p>
            <p className="text-sm text-gray-500 mt-1">Agrega tu primer cliente para comenzar.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-4 px-6">Nombre</th>
                  <th className="py-4 px-6">Email</th>
                  <th className="py-4 px-6">Teléfono</th>
                  <th className="py-4 px-6">Dirección</th>
                  <th className="py-4 px-6 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="py-4 px-6 font-semibold text-gray-900 dark:text-gray-100">{c.name}</td>
                    <td className="py-4 px-6 text-gray-600 dark:text-gray-400">{c.email || '—'}</td>
                    <td className="py-4 px-6 text-gray-600 dark:text-gray-400">{c.phone || '—'}</td>
                    <td className="py-4 px-6 text-gray-600 dark:text-gray-400 max-w-[200px] truncate">{c.address || '—'}</td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openHistory(c)} className="p-1.5 text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800" title="Historial">
                          <ShoppingBag className="h-4 w-4" />
                        </button>
                        <button onClick={() => openEdit(c)} className="p-1.5 text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800" title="Editar">
                          <Edit className="h-4 w-4" />
                        </button>
                        <button onClick={() => setDeleteTarget(c)} className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800" title="Eliminar">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs">
          <Card className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 relative">
            <button onClick={() => setModalOpen(false)} className="absolute right-4 top-4 p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              <X className="h-5 w-5" />
            </button>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">{editing ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Nombre *</label>
                <Input required placeholder="Nombre del cliente" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Email</label>
                <Input type="email" placeholder="cliente@ejemplo.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Teléfono</label>
                <Input placeholder="+54 11 1234-5678" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Dirección</label>
                <Input placeholder="Dirección del cliente" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={submitting}>{submitting ? 'Guardando...' : 'Guardar'}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* History Modal */}
      {historyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs">
          <Card className="w-full max-w-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 relative max-h-[85vh] flex flex-col">
            <button onClick={() => setHistoryTarget(null)} className="absolute right-4 top-4 p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              <X className="h-5 w-5" />
            </button>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Historial de {historyTarget.name}</h2>
            {historyLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-indigo-500" /></div>
            ) : historyData ? (
              <>
                <div className="flex gap-4 mb-4 text-sm">
                  <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400"><ShoppingBag className="h-4 w-4" /> {historyData.visitCount} compra(s)</span>
                  <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400"><DollarSign className="h-4 w-4" /> Total: ${historyData.totalSpent.toFixed(2)}</span>
                </div>
                <div className="overflow-y-auto flex-1 space-y-3">
                  {historyData.sales.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">Sin compras registradas.</p>
                  ) : historyData.sales.map((s: any) => (
                    <div key={s.id} className="p-4 border border-gray-100 dark:border-gray-800 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-mono text-gray-400">#{s.id.slice(0, 8)}</span>
                        <span className="text-sm font-semibold text-green-600 dark:text-green-400">${s.total?.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                        <CalendarDays className="h-3 w-3" />
                        {new Date(s.created_at).toLocaleDateString('es-AR', { dateStyle: 'medium' })}
                      </div>
                      <div className="space-y-1">
                        {s.items?.map((i: any) => (
                          <div key={i.id} className="flex justify-between text-xs text-gray-700 dark:text-gray-300">
                            <span>{i.product_name} × {i.quantity}</span>
                            <span>${i.subtotal?.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500 text-center py-8">Error al cargar historial.</p>
            )}
          </Card>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Eliminar Cliente"
        message={`¿Estás seguro de eliminar a "${deleteTarget?.name}"? Esta acción no se puede deshacer.`}
        variant="danger"
        confirmLabel="Eliminar"
      />
    </div>
  );
}
