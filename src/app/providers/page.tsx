'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Truck,
  Plus,
  Edit,
  Trash2,
  Search,
  Loader2,
  X,
} from 'lucide-react';
import type { Supplier, PurchaseOrder } from '@/lib/types/supplier';
import type { CommercialDocument } from '@/lib/types/document';

export default function ProvidersPage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  // Supplier form
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contact_name: '',
    email: '',
    phone: '',
    address: '',
    notes: '',
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [supplierIdToDelete, setSupplierIdToDelete] = useState<string | null>(null);

  // Selected supplier document chain
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [remitos, setRemitos] = useState<CommercialDocument[]>([]);
  const [loadingChain, setLoadingChain] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const supRes = await fetch('/api/suppliers', { headers });

      if (cancelled) return;
      if (supRes.ok) setSuppliers(await supRes.json());
    })().catch(console.error).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [tenantId]);

  const refreshSuppliers = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {};
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    const res = await fetch('/api/suppliers', { headers });
    if (res.ok) setSuppliers(await res.json());
  };

  const fetchDocumentChain = async (supplierId: string) => {
    setLoadingChain(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const [posRes, docsRes] = await Promise.all([
        fetch(`/api/purchase-orders?supplier_id=${supplierId}`, { headers }),
        fetch('/api/documents?type=remito_ingreso', { headers }),
      ]);

      const pos: PurchaseOrder[] = posRes.ok ? await posRes.json() : [];
      const allRemitos: CommercialDocument[] = docsRes.ok ? await docsRes.json() : [];

      setPurchaseOrders(pos);
      setRemitos(allRemitos.filter(r => pos.some(po => po.id === r.purchase_order_id)));
    } catch {
      toast.error('Error al cargar documentos del proveedor');
    } finally {
      setLoadingChain(false);
    }
  };

  const handleSelectSupplier = (supplierId: string) => {
    if (selectedSupplierId === supplierId) {
      setSelectedSupplierId(null);
    } else {
      setSelectedSupplierId(supplierId);
      fetchDocumentChain(supplierId);
    }
  };

  const filteredSuppliers = suppliers.filter((s) =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.contact_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const openSupplierModal = (supplier: Supplier | null = null) => {
    if (supplier) {
      setEditingSupplier(supplier);
      setSupplierForm({
        name: supplier.name || '',
        contact_name: supplier.contact_name || '',
        email: supplier.email || '',
        phone: supplier.phone || '',
        address: supplier.address || '',
        notes: supplier.notes || '',
      });
    } else {
      setEditingSupplier(null);
      setSupplierForm({ name: '', contact_name: '', email: '', phone: '', address: '', notes: '' });
    }
    setIsSupplierModalOpen(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierForm.name) {
      toast.error('El nombre del proveedor es requerido');
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const url = editingSupplier ? `/api/suppliers/${editingSupplier.id}` : '/api/suppliers';
      const method = editingSupplier ? 'PATCH' : 'POST';

      const res = await fetch(url, { method, headers, body: JSON.stringify(supplierForm) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar');

      toast.success(editingSupplier ? 'Proveedor actualizado' : 'Proveedor creado');
      setIsSupplierModalOpen(false);
      refreshSuppliers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    }
  };

  const handleDeleteSupplier = async (id: string) => {
    setSupplierIdToDelete(id);
  };

  const handleConfirmDelete = async () => {
    if (!supplierIdToDelete) return;
    const id = supplierIdToDelete;
    setSupplierIdToDelete(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const res = await fetch(`/api/suppliers/${id}`, { method: 'DELETE', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al eliminar');
      toast.success('Proveedor eliminado');
      refreshSuppliers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error');
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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Truck className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
            Proveedores
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Administra tus proveedores.
          </p>
        </div>
        <Button variant="outline" onClick={() => openSupplierModal(null)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Nuevo Proveedor
        </Button>
      </div>

      <Card className="p-4 border border-gray-100 dark:border-gray-800">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            type="text"
            placeholder="Buscar proveedor por nombre, contacto o email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
      </Card>

      <Card className="overflow-hidden border border-gray-100 dark:border-gray-800 p-0">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          </div>
        ) : filteredSuppliers.length === 0 ? (
          <div className="text-center py-16">
            <Truck className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-gray-500">No hay proveedores registrados</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-4 px-6">Nombre</th>
                  <th className="py-4 px-6">Contacto</th>
                  <th className="py-4 px-6">Email / Teléfono</th>
                  <th className="py-4 px-6">Dirección</th>
                  <th className="py-4 px-6 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                {filteredSuppliers.map((supplier) => (
                  <React.Fragment key={supplier.id}>
                    <tr
                      onClick={() => handleSelectSupplier(supplier.id)}
                      className={`cursor-pointer transition-colors ${
                        selectedSupplierId === supplier.id
                          ? 'bg-indigo-50/80 dark:bg-indigo-900/20'
                          : 'hover:bg-gray-50/50 dark:hover:bg-gray-800/20'
                      }`}
                    >
                      <td className="py-4 px-6">
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{supplier.name}</div>
                      </td>
                      <td className="py-4 px-6 text-gray-600 dark:text-gray-400">
                        {supplier.contact_name || '—'}
                      </td>
                      <td className="py-4 px-6">
                        <div className="text-gray-900 dark:text-gray-100">{supplier.email || '—'}</div>
                        <div className="text-xs text-gray-500">{supplier.phone || ''}</div>
                      </td>
                      <td className="py-4 px-6 text-xs text-gray-500">
                        {supplier.address || '—'}
                      </td>
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); openSupplierModal(supplier); }}
                            className="p-1.5 text-gray-500 hover:text-indigo-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteSupplier(supplier.id); }}
                            className="p-1.5 text-gray-500 hover:text-red-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {selectedSupplierId === supplier.id && (
                      <tr>
                        <td colSpan={5} className="p-0">
                          <div className="border-t border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/10">
                            {loadingChain ? (
                              <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                              </div>
                            ) : purchaseOrders.length === 0 ? (
                              <div className="text-center py-8 text-sm text-gray-500">
                                No hay documentos asociados a este proveedor.
                              </div>
                            ) : (
                              <div className="py-4 px-6 space-y-3">
                                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                                  Documentos Relacionados
                                </h3>
                                {purchaseOrders.map((po, poIdx) => {
                                  const poRemitos = remitos.filter(r => r.purchase_order_id === po.id);
                                  const isLast = poIdx === purchaseOrders.length - 1;
                                  return (
                                    <DocumentChainItem
                                      key={po.id}
                                      label="Pedido de Compra"
                                      number={po.id.slice(0, 8)}
                                      status={po.status}
                                      total={po.total_cents}
                                      date={po.created_at}
                                      href={`/documentos?type=orden_compra&selected=${po.id}`}
                                      isLast={isLast}
                                    >
                                      {poRemitos.map((rem, remIdx) => {
                                        const isLastRem = remIdx === poRemitos.length - 1;
                                        return (
                                          <DocumentChainItem
                                            key={rem.id}
                                            label="Remito de Ingreso"
                                            number={String(rem.document_number).padStart(6, '0')}
                                            status={rem.status}
                                            total={rem.total_cents}
                                            isLast={isLastRem}
                                            isChild
                                            href={`/documentos?type=remito_ingreso&selected=${rem.id}`}
                                          />
                                        );
                                      })}
                                    </DocumentChainItem>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Supplier Modal */}
      {isSupplierModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs">
          <Card className="w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 relative">
            <button
              onClick={() => setIsSupplierModalOpen(false)}
              className="absolute right-4 top-4 p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              {editingSupplier ? 'Editar Proveedor' : 'Nuevo Proveedor'}
            </h2>

            <form onSubmit={handleSaveSupplier} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Nombre *
                </label>
                <Input
                  type="text"
                  required
                  placeholder="Nombre del proveedor"
                  value={supplierForm.name}
                  onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Persona de Contacto
                  </label>
                  <Input
                    type="text"
                    placeholder="Nombre del contacto"
                    value={supplierForm.contact_name}
                    onChange={(e) => setSupplierForm({ ...supplierForm, contact_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Teléfono
                  </label>
                  <Input
                    type="text"
                    placeholder="Teléfono"
                    value={supplierForm.phone}
                    onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Email
                </label>
                <Input
                  type="email"
                  placeholder="proveedor@ejemplo.com"
                  value={supplierForm.email}
                  onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Dirección
                </label>
                <Input
                  type="text"
                  placeholder="Dirección"
                  value={supplierForm.address}
                  onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Notas
                </label>
                <textarea
                  className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  rows={3}
                  placeholder="Notas adicionales..."
                  value={supplierForm.notes}
                  onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                <Button type="button" variant="outline" onClick={() => setIsSupplierModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit">
                  {editingSupplier ? 'Guardar Cambios' : 'Crear Proveedor'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <ConfirmModal
        open={!!supplierIdToDelete}
        onCancel={() => setSupplierIdToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Eliminar proveedor"
        message="¿Estás seguro de eliminar este proveedor? Esta acción no se puede deshacer."
        variant="danger"
        confirmLabel="Eliminar"
      />
    </div>
  );
}

const statusLabels: Record<string, { label: string; color: string }> = {
  draft: { label: 'Borrador', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  sent: { label: 'Enviado', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  partial: { label: 'Recibido Parcial', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  received: { label: 'Recibido', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  cancelled: { label: 'Cancelado', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  pending: { label: 'Pendiente', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  completed: { label: 'Completado', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
};

function StatusBadge({ status }: { status: string }) {
  const s = statusLabels[status] ?? { label: status, color: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>
      {s.label}
    </span>
  );
}

function formatARS(cents: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(cents / 100);
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function DocumentChainItem({
  label,
  number,
  status,
  total,
  isLast,
  isChild,
  date,
  href,
  children,
}: {
  label: string;
  number: string;
  status: string;
  total: number;
  isLast: boolean;
  isChild?: boolean;
  date?: string;
  href?: string;
  children?: React.ReactNode;
}) {
  const header = (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-medium text-indigo-700 dark:text-indigo-300">{label}</span>
      <span className="font-mono text-gray-900 dark:text-gray-100">#{number}</span>
      <StatusBadge status={status} />
      <span className="text-xs text-gray-400 ml-2">{date ? formatDate(date) : ''}</span>
      <span className="text-gray-500 ml-auto">{formatARS(total)}</span>
    </div>
  );

  return (
    <div className="relative pl-8">
      {!isLast && (
        <div className="absolute left-2.5 top-5 bottom-0 w-px bg-indigo-200 dark:bg-indigo-700" />
      )}
      <div className="absolute left-1.5 top-2 w-2 h-2 rounded-full bg-indigo-400 dark:bg-indigo-500 border-2 border-white dark:border-gray-900" />
      <div className={isChild ? 'ml-6' : ''}>
        {href ? (
          <Link href={href} className="block rounded-md hover:bg-indigo-100/50 dark:hover:bg-indigo-900/20 transition-colors -mx-2 px-2 py-1">
            {header}
          </Link>
        ) : (
          header
        )}
        {children && <div className="mt-2 space-y-2">{children}</div>}
      </div>
    </div>
  );
}
