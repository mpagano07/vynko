'use client';

import { useState, useEffect, useRef } from 'react';
import { authFetch } from '@/lib/fetchWithTenant';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { LoadingState } from '@/components/ui/loading-state';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import { Thead, Th } from '@/components/ui/table-header';
import { PageHeader } from '@/components/ui/page-header';
import { IconAction } from '@/components/ui/icon-action';
import { Plus, Edit, Trash2, Users, Loader2, ShoppingBag, DollarSign, CalendarDays } from 'lucide-react';
import { formatARS } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/format';
import { matchesQuery } from '@/lib/utils/text';
import { SortableTh, SortDir } from '@/components/ui/sortable-th';
import { FormLabel } from '@/components/ui/form-label';
import {
  IVA_CONDITIONS,
  IVA_CONDITION_LABELS,
  PARTY_DOCUMENT_TYPES,
  PARTY_DOCUMENT_TYPE_LABELS,
  formatCuit,
  formatCuitInput,
  formatDocumentNumberInput,
  validatePartyTaxFields,
} from '@/lib/tax-fields';
import toast from 'react-hot-toast';

type SortKey = 'name' | 'email' | 'phone' | 'address';

interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  cuit?: string | null;
  iva_condition?: string | null;
  document_type?: string | null;
  document_number?: string | null;
  created_at?: string;
}

interface CustomerHistoryItem {
  id: string;
  product_name?: string;
  quantity: number;
  subtotal?: number;
}

interface CustomerHistorySale {
  id: string;
  total?: number;
  created_at: string;
  items?: CustomerHistoryItem[];
}

interface CustomerHistory {
  sales: CustomerHistorySale[];
  totalSpent: number;
  visitCount: number;
}

function emptyCustomerForm() {
  return {
    name: '',
    email: '',
    phone: '',
    address: '',
    cuit: '',
    iva_condition: 'consumidor_final',
    document_type: 'DNI',
    document_number: '',
  };
}

type CustomerForm = ReturnType<typeof emptyCustomerForm>;

function customerFormFrom(c: Customer): CustomerForm {
  const documentType = c.document_type || 'DNI';
  return {
    name: c.name,
    email: c.email || '',
    phone: c.phone || '',
    address: c.address || '',
    cuit: formatCuitInput(c.cuit || ''),
    iva_condition: c.iva_condition || 'consumidor_final',
    document_type: documentType,
    document_number: formatDocumentNumberInput(c.document_number || '', documentType),
  };
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState(emptyCustomerForm());
  const [submitting, setSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  const [historyTarget, setHistoryTarget] = useState<Customer | null>(null);
  const [historyData, setHistoryData] = useState<CustomerHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchCustomers = async () => {
    try {
      const res = await authFetch('/api/customers');
      if (res.ok) setCustomers(await res.json());
      else toast.error('No se pudieron cargar los clientes');
    } catch {
      toast.error('Error de conexión al cargar clientes');
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCustomers().finally(() => setLoading(false));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyCustomerForm());
    setModalOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm(customerFormFrom(c));
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('El nombre es requerido'); return; }

    const taxError = validatePartyTaxFields(form, { requireCuit: true });
    if (taxError) { toast.error(taxError); return; }

    setSubmitting(true);
    try {
      const url = editing ? `/api/customers/${editing.id}` : '/api/customers';
      const method = editing ? 'PATCH' : 'POST';
      const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Error al guardar'); return; }

      toast.success(editing ? 'Cliente actualizado' : 'Cliente creado');
      setModalOpen(false);
      fetchCustomers();
    } catch {
      toast.error('Error de conexión al guardar el cliente');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await authFetch(`/api/customers/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Error al eliminar'); return; }
      toast.success('Cliente eliminado');
      setDeleteTarget(null);
      fetchCustomers();
    } catch {
      toast.error('Error de conexión al eliminar el cliente');
    }
  };

  const openHistory = async (c: Customer) => {
    setHistoryTarget(c);
    setHistoryLoading(true);
    setHistoryData(null);
    try {
      const res = await authFetch(`/api/customers/${c.id}/history`);
      if (res.ok) setHistoryData(await res.json());
    } catch {
      toast.error('Error de conexión al cargar el historial');
    } finally {
      setHistoryLoading(false);
    }
  };

  const filtered = customers.filter(c =>
    matchesQuery(c.name, search) ||
    matchesQuery(c.email, search) ||
    matchesQuery(c.phone, search) ||
    matchesQuery(c.cuit, search) ||
    matchesQuery(c.document_number, search)
  );

  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedCustomers = sortKey
    ? [...filtered].sort((a, b) => {
        let va: string;
        let vb: string;
        switch (sortKey) {
          case 'name': va = a.name; vb = b.name; break;
          case 'email': va = a.email || ''; vb = b.email || ''; break;
          case 'phone': va = a.phone || ''; vb = b.phone || ''; break;
          case 'address': va = a.address || ''; vb = b.address || ''; break;
          default: return 0;
        }
        const cmp = va.localeCompare(vb, 'es', { sensitivity: 'base' });
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : filtered;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Users className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />}
        title="Clientes"
        subtitle="Gestiona tus clientes y consulta su historial de compras."
        subtitleClassName="text-gray-500 dark:text-gray-400"
        actions={
          <Button onClick={openCreate} className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Nuevo Cliente
          </Button>
        }
      />

      <Card className="p-4 border border-gray-100 dark:border-gray-800">
        <SearchInput ref={searchInputRef} placeholder="Buscar por nombre, CUIT, documento, email o teléfono..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </Card>

      <Card className="overflow-hidden border border-gray-100 dark:border-gray-800 p-0">
        {loading ? (
          <LoadingState label="Cargando clientes..." />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title="No se encontraron clientes" description="Agrega tu primer cliente para comenzar." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <Thead>
                <SortableTh label="Nombre" sortFor="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-6" />
                <Th>Documento</Th>
                <SortableTh label="Email" sortFor="email" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-6" />
                <SortableTh label="Teléfono" sortFor="phone" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-6" />
                <SortableTh label="Dirección" sortFor="address" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-6" />
                <Th align="right">Acciones</Th>
              </Thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                {sortedCustomers.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="py-4 px-6 font-semibold text-gray-900 dark:text-gray-100">{c.name}</td>
                    <td className="py-4 px-6 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {c.cuit
                        ? formatCuit(c.cuit)
                        : c.document_number
                          ? `${c.document_type ? `${c.document_type} ` : ''}${c.document_number}`
                          : '—'}
                    </td>
                    <td className="py-4 px-6 text-gray-600 dark:text-gray-400">{c.email || '—'}</td>
                    <td className="py-4 px-6 text-gray-600 dark:text-gray-400">{c.phone || '—'}</td>
                    <td className="py-4 px-6 text-gray-600 dark:text-gray-400 max-w-[200px] truncate">{c.address || '—'}</td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-1">
                          <IconAction
                            icon={ShoppingBag}
                            label="Ver historial"
                            title="Historial"
                            tone="indigo"
                            onClick={() => openHistory(c)}
                          />
                          <IconAction
                            icon={Edit}
                            label={`Editar ${c.name}`}
                            title="Editar"
                            tone="indigo"
                            onClick={() => openEdit(c)}
                          />
                          <IconAction
                            icon={Trash2}
                            label={`Eliminar ${c.name}`}
                            title="Eliminar"
                            tone="red"
                            onClick={() => setDeleteTarget(c)}
                          />
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
        <Modal onClose={() => setModalOpen(false)} className="max-w-lg" title={editing ? 'Editar Cliente' : 'Nuevo Cliente'}>
          <form onSubmit={handleSave} className="space-y-4">
              <div>
                <FormLabel>Nombre o Razón Social *</FormLabel>
                <Input required placeholder="Nombre del cliente" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>

              <div className="space-y-4 rounded-lg border border-gray-100 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-gray-900/40">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Datos fiscales para facturar
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FormLabel>CUIT</FormLabel>
                    <Input placeholder="20-12345678-9" inputMode="numeric" value={form.cuit} onChange={(e) => setForm({ ...form, cuit: formatCuitInput(e.target.value) })} />
                  </div>
                  <div>
                    <FormLabel>Condición frente al IVA</FormLabel>
                    <Select value={form.iva_condition} onChange={(e) => setForm({ ...form, iva_condition: e.target.value })}>
                      {IVA_CONDITIONS.map((c) => (
                        <option key={c} value={c}>{IVA_CONDITION_LABELS[c]}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <FormLabel>Tipo de documento</FormLabel>
                    <Select
                      value={form.document_type}
                      onChange={(e) => {
                        const document_type = e.target.value;
                        setForm({
                          ...form,
                          document_type,
                          document_number: formatDocumentNumberInput(form.document_number, document_type),
                        });
                      }}
                    >
                      {PARTY_DOCUMENT_TYPES.map((t) => (
                        <option key={t} value={t}>{PARTY_DOCUMENT_TYPE_LABELS[t]}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <FormLabel>Número de documento</FormLabel>
                    <Input
                      placeholder="12345678"
                      inputMode="numeric"
                      value={form.document_number}
                      onChange={(e) => setForm({ ...form, document_number: formatDocumentNumberInput(e.target.value, form.document_type) })}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <FormLabel>Email</FormLabel>
                  <Input type="email" placeholder="cliente@ejemplo.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div>
                  <FormLabel>Teléfono</FormLabel>
                  <Input placeholder="+54 11 1234-5678" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>

              <div>
                <FormLabel>Dirección</FormLabel>
                <Input placeholder="Dirección del cliente" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={submitting}>{submitting ? 'Guardando...' : 'Guardar'}</Button>
              </div>
            </form>
          </Modal>
      )}

      {/* History Modal */}
      {historyTarget && (
        <Modal onClose={() => setHistoryTarget(null)} className="max-w-2xl max-h-[85vh] flex flex-col" title={`Historial de ${historyTarget.name}`} titleClassName="mb-1">
            {historyLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-indigo-500" /></div>
            ) : historyData ? (
              <>
                <div className="flex gap-4 mb-4 text-sm">
                  <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400"><ShoppingBag className="h-4 w-4" /> {historyData.visitCount} compra(s)</span>
                  <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400"><DollarSign className="h-4 w-4" /> Total: {formatARS(historyData.totalSpent)}</span>
                </div>
                <div className="overflow-y-auto flex-1 space-y-3">
                  {historyData.sales.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">Sin compras registradas.</p>
                  ) : historyData.sales.map((s) => (
                    <div key={s.id} className="p-4 border border-gray-100 dark:border-gray-800 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-mono text-gray-400">#{s.id.slice(0, 8)}</span>
                        <span className="text-sm font-semibold text-green-600 dark:text-green-400">{s.total != null ? formatARS(s.total) : ''}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                        <CalendarDays className="h-3 w-3" />
                        {formatDate(s.created_at, { dateStyle: 'medium' })}
                      </div>
                      <div className="space-y-1">
                        {s.items?.map((i) => (
                          <div key={i.id} className="flex justify-between text-xs text-gray-700 dark:text-gray-300">
                            <span>{i.product_name} × {i.quantity}</span>
                            <span>{i.subtotal != null ? formatARS(i.subtotal) : ''}</span>
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
          </Modal>
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
