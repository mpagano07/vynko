'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import toast from 'react-hot-toast';
import {
  Truck,
  Plus,
  Edit,
  Trash2,
  Search,
  Loader2,
  Package,
  X,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
} from 'lucide-react';
import type { Supplier, PurchaseOrder } from '@/lib/types/supplier';

interface ProductOption {
  id: string;
  name: string;
  cost: number;
}

export default function ProvidersPage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;
  const searchParams = useSearchParams();
  const prefillProductId = searchParams?.get('productId') ?? null;
  const prefillQty = Number(searchParams?.get('qty')) || 1;

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
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

  // PO form
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poExpectedDate, setPoExpectedDate] = useState('');
  const [poNotes, setPoNotes] = useState('');
  const [poItems, setPoItems] = useState<{ product_id: string; quantity: number; unit_cost: number }[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedQty, setSelectedQty] = useState(1);
  const [isSubmittingPo, setIsSubmittingPo] = useState(false);

  const [showOrdersList, setShowOrdersList] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [poStatus, setPoStatus] = useState<'draft' | 'pending'>('draft');
  const [confirmAction, setConfirmAction] = useState<{
    type: 'delete-supplier' | 'receive-order' | 'cancel-order';
    id: string;
  } | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const [supRes, prodRes, ordRes] = await Promise.all([
        fetch('/api/suppliers', { headers }),
        fetch('/api/products', { headers }),
        fetch('/api/purchase-orders', { headers }),
      ]);

      if (cancelled) return;
      const [suppliersData, productsData, ordersData] = await Promise.all([
        supRes.ok ? supRes.json() : [],
        prodRes.ok ? prodRes.json() : [],
        ordRes.ok ? ordRes.json() : [],
      ]);

      if (!cancelled) {
        setSuppliers(suppliersData);
        setProducts(productsData);
        setOrders(ordersData);

        if (prefillProductId && productsData.length > 0) {
          const product = productsData.find((p: ProductOption) => p.id === prefillProductId);
          if (product) {
            setPoItems([{ product_id: prefillProductId, quantity: prefillQty, unit_cost: product.cost || 0 }]);
            setIsPoModalOpen(true);
          }
        }
      }
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

  const refreshOrders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {};
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    const res = await fetch('/api/purchase-orders', { headers });
    if (res.ok) setOrders(await res.json());
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
    setConfirmAction({ type: 'delete-supplier', id });
  };

  const addPoItem = () => {
    if (!selectedProductId) {
      toast.error('Selecciona un producto');
      return;
    }
    setPoItems((prev) => {
      const existing = prev.find((i) => i.product_id === selectedProductId);
      if (existing) {
        return prev.map((i) =>
          i.product_id === selectedProductId
            ? { ...i, quantity: i.quantity + selectedQty }
            : i
        );
      }
      const product = products.find((p) => p.id === selectedProductId);
      return [...prev, { product_id: selectedProductId, quantity: selectedQty, unit_cost: product?.cost || 0 }];
    });
    setSelectedProductId('');
    setSelectedQty(1);
  };

  const removePoItem = (productId: string) => {
    setPoItems((prev) => prev.filter((i) => i.product_id !== productId));
  };

  const poTotalCents = poItems.reduce(
    (sum, item) => sum + item.quantity * Math.round(item.unit_cost * 100),
    0
  );

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poSupplierId) {
      toast.error('Selecciona un proveedor');
      return;
    }
    if (poItems.length === 0) {
      toast.error('Agrega al menos un producto al pedido');
      return;
    }

    setIsSubmittingPo(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const res = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          supplier_id: poSupplierId,
          expected_date: poExpectedDate || null,
          notes: poNotes || null,
          status: poStatus,
          items: poItems.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity,
            unit_cost: i.unit_cost,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al crear el pedido');

      toast.success('Pedido creado exitosamente');
      setIsPoModalOpen(false);
      setPoSupplierId('');
      setPoExpectedDate('');
      setPoNotes('');
      setPoItems([]);
      setPoStatus('draft');
      refreshOrders();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al crear pedido');
    } finally {
      setIsSubmittingPo(false);
    }
  };

  const handleReceiveOrder = async (id: string) => {
    setConfirmAction({ type: 'receive-order', id });
  };

  const handleCancelOrder = async (id: string) => {
    setConfirmAction({ type: 'cancel-order', id });
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { type, id } = confirmAction;
    setConfirmAction(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      if (type === 'receive-order') {
        const res = await fetch(`/api/purchase-orders/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'received' }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al recibir pedido');
        toast.success('Pedido recibido — stock actualizado');
        refreshOrders();
        refreshSuppliers();
      } else if (type === 'cancel-order') {
        const res = await fetch(`/api/purchase-orders/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'cancelled' }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al cancelar pedido');
        toast.success('Pedido cancelado');
        refreshOrders();
      } else if (type === 'delete-supplier') {
        const res = await fetch(`/api/suppliers/${id}`, { method: 'DELETE', headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al eliminar');
        toast.success('Proveedor eliminado');
        refreshSuppliers();
      }
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
            Administra tus proveedores y crea pedidos de compra.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => setIsPoModalOpen(true)} className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Nuevo Pedido
          </Button>
          <Button variant="outline" onClick={() => openSupplierModal(null)} className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Nuevo Proveedor
          </Button>
        </div>
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
                  <tr key={supplier.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
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
                          onClick={() => openSupplierModal(supplier)}
                          className="p-1.5 text-gray-500 hover:text-indigo-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteSupplier(supplier.id)}
                          className="p-1.5 text-gray-500 hover:text-red-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
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

      <Card className="border border-gray-100 dark:border-gray-800">
        <button
          onClick={() => setShowOrdersList(!showOrdersList)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Package className="h-5 w-5 text-indigo-600" />
            Pedidos de Compra
          </h2>
          {showOrdersList ? (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          )}
        </button>

        {showOrdersList && (
          <div className="border-t border-gray-100 dark:border-gray-800">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
              </div>
            ) : orders.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                No hay pedidos registrados
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <th className="py-3 px-4">Folio</th>
                      <th className="py-3 px-4">Proveedor</th>
                      <th className="py-3 px-4">Estado</th>
                      <th className="py-3 px-4 text-right">Total</th>
                      <th className="py-3 px-4 text-right">Fecha</th>
                      <th className="py-3 px-4 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                    {orders.map((order) => (
                      <tr key={order.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                        <td className="py-3 px-4 font-mono text-xs text-gray-500">
                          #{order.id.slice(0, 8)}
                        </td>
                        <td className="py-3 px-4 text-gray-900 dark:text-gray-100">
                          {order.supplier_name || '—'}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            order.status === 'draft'
                              ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                              : order.status === 'pending'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                              : order.status === 'received'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          }`}>
                            {order.status === 'draft' ? 'Borrador' : order.status === 'pending' ? 'Pendiente' : order.status === 'received' ? 'Recibido' : 'Cancelado'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-gray-900 dark:text-gray-100">
                          ${(order.total_cents / 100).toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right text-xs text-gray-500">
                          {new Date(order.created_at!).toLocaleDateString('es-ES', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                          })}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {order.status === 'draft' && (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleReceiveOrder(order.id)}
                                className="px-2 py-1 text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 rounded"
                              >
                                Recibir
                              </button>
                              <button
                                onClick={() => handleCancelOrder(order.id)}
                                className="px-2 py-1 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 rounded"
                              >
                                Cancelar
                              </button>
                            </div>
                          )}
                          {order.status === 'pending' && (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleReceiveOrder(order.id)}
                                className="px-2 py-1 text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 rounded"
                              >
                                Recibir
                              </button>
                              <button
                                onClick={() => handleCancelOrder(order.id)}
                                className="px-2 py-1 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 rounded"
                              >
                                Cancelar
                              </button>
                            </div>
                          )}
                          {order.status === 'received' && (
                            <span className="text-xs text-gray-400">Completado</span>
                          )}
                          {order.status === 'cancelled' && (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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

      {/* Purchase Order Modal */}
      {isPoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs">
          <Card className="w-full max-w-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 relative flex flex-col max-h-[90vh]">
            <button
              onClick={() => setIsPoModalOpen(false)}
              className="absolute right-4 top-4 p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Nuevo Pedido de Compra
            </h2>

            <form onSubmit={handleCreatePo} className="space-y-4 overflow-y-auto pr-1 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Proveedor *
                  </label>
                  <Select value={poSupplierId} onChange={(e) => setPoSupplierId(e.target.value)} required>
                    <option value="">Seleccionar proveedor...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Fecha Esperada
                  </label>
                  <Input
                    type="date"
                    value={poExpectedDate}
                    onChange={(e) => setPoExpectedDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Estado
                  </label>
                  <Select value={poStatus} onChange={(e) => setPoStatus(e.target.value as 'draft' | 'pending')}>
                    <option value="draft">Borrador</option>
                    <option value="pending">Pendiente (enviado)</option>
                  </Select>
                </div>
              </div>

              <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">Productos</h3>

                <div className="flex items-end gap-2 mb-3">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Producto
                    </label>
                    <Select value={selectedProductId} onChange={(e) => {
                      const pid = e.target.value;
                      setSelectedProductId(pid);
                      const p = products.find((pr) => pr.id === pid);
                      if (p) setSelectedQty(1);
                    }}>
                      <option value="">Seleccionar...</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-24">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Cantidad
                    </label>
                    <Input
                      type="number"
                      min="1"
                      value={selectedQty}
                      onChange={(e) => setSelectedQty(Number(e.target.value) || 1)}
                    />
                  </div>
                  <Button type="button" variant="outline" onClick={addPoItem} className="mb-0.5">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {poItems.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {poItems.map((item) => {
                      const product = products.find((p) => p.id === item.product_id);
                      return (
                        <div key={item.product_id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {product?.name || item.product_id}
                            </p>
                            <p className="text-xs text-gray-500">
                              ${item.unit_cost.toFixed(2)} x {item.quantity} = ${(item.quantity * item.unit_cost).toFixed(2)}
                            </p>
                          </div>
                          <button
                            onClick={() => removePoItem(item.product_id)}
                            className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Notas del pedido
                </label>
                <textarea
                  className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  rows={2}
                  placeholder="Condiciones de pago, instrucciones de entrega..."
                  value={poNotes}
                  onChange={(e) => setPoNotes(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-between text-lg font-bold text-gray-900 dark:text-gray-100 pt-2">
                <span>Total Estimado</span>
                <span className="text-2xl text-indigo-600 dark:text-indigo-400">
                  ${(poTotalCents / 100).toFixed(2)}
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                <Button type="button" variant="outline" onClick={() => setIsPoModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isSubmittingPo}>
                  {isSubmittingPo ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creando...</>
                  ) : (
                    <><Check className="h-4 w-4 mr-2" />Crear Pedido</>
                  )}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <ConfirmModal
        open={!!confirmAction}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
        title={
          confirmAction?.type === 'delete-supplier' ? 'Eliminar proveedor' :
          confirmAction?.type === 'receive-order' ? 'Recibir pedido' :
          'Cancelar pedido'
        }
        message={
          confirmAction?.type === 'delete-supplier' ? '¿Estás seguro de eliminar este proveedor? Esta acción no se puede deshacer.' :
          confirmAction?.type === 'receive-order' ? '¿Marcar este pedido como recibido? Se actualizará el stock de los productos.' :
          '¿Cancelar este pedido?'
        }
        variant={confirmAction?.type === 'delete-supplier' || confirmAction?.type === 'cancel-order' ? 'danger' : undefined}
        confirmLabel={
          confirmAction?.type === 'delete-supplier' ? 'Eliminar' :
          confirmAction?.type === 'receive-order' ? 'Recibir' :
          'Cancelar pedido'
        }
      />
    </div>
  );
}
