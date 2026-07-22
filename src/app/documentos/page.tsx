'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import toast from 'react-hot-toast';
import {
  FileText,
  Plus,
  Loader2,
  Search,
  Check,
  Trash2,
  ChevronDown,
  ChevronUp,
  Printer,
} from 'lucide-react';
import type {
  CommercialDocument,
  DocumentType,
  DocumentStatus,
  CreateDocumentRequest,
} from '@/lib/types/document';
import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_COLORS,
  VALID_STATUSES_PER_TYPE,
} from '@/lib/types/document';

const DOCUMENT_TYPE_COLORS: Record<DocumentType, { border: string; bg: string; text: string }> = {
  presupuesto: { border: 'border-l-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/20', text: 'text-purple-700 dark:text-purple-400' },
  orden_venta: { border: 'border-l-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/20', text: 'text-amber-700 dark:text-amber-400' },
  orden_compra: { border: 'border-l-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/20', text: 'text-blue-700 dark:text-blue-400' },
  remito_salida: { border: 'border-l-indigo-500', bg: 'bg-indigo-50 dark:bg-indigo-950/20', text: 'text-indigo-700 dark:text-indigo-400' },
  remito_ingreso: { border: 'border-l-teal-500', bg: 'bg-teal-50 dark:bg-teal-950/20', text: 'text-teal-700 dark:text-teal-400' },
};
import type { Customer } from '@/lib/types/sale';
import type { Product } from '@/lib/types/product';
import type { Supplier } from '@/lib/types/supplier';

interface DocumentItem {
  product_id?: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
}

export default function DocumentosPage() {
  const { tenant } = useAuth();

  const [documents, setDocuments] = useState<CommercialDocument[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<DocumentType>('remito_salida');
  const [creating, setCreating] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    variant: 'danger' | 'default';
    confirmLabel: string;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', variant: 'default', confirmLabel: 'Confirmar', onConfirm: () => {} });

  const [formData, setFormData] = useState<CreateDocumentRequest>({
    document_type: 'remito_salida',
    customer_id: '',
    customer_name: '',
    supplier_name: '',
    notes: '',
    valid_until: '',
    delivery_date: '',
    items: [],
  });

  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = {
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };

      const [docsRes, custRes, prodRes, suppRes] = await Promise.all([
        fetch('/api/documents', { headers }),
        fetch('/api/customers', { headers }),
        fetch('/api/products', { headers }),
        fetch('/api/suppliers', { headers }),
      ]);

      if (cancelled) return;
      if (docsRes.ok) setDocuments(await docsRes.json());
      if (custRes.ok) setCustomers(await custRes.json());
      if (prodRes.ok) {
        const allProducts: Product[] = await prodRes.json();
        setProducts(allProducts.filter(p => p.is_active !== false));
      }
      if (suppRes.ok) setSuppliers(await suppRes.json());
    })().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [tenant?.id]);

  const filteredDocuments = useMemo(() => {
    return documents.filter(doc => {
      const matchesType = doc.document_type === typeFilter;
      const matchesSearch = !search ||
        doc.customer_name.toLowerCase().includes(search.toLowerCase()) ||
        String(doc.document_number).includes(search) ||
        doc.supplier_name?.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || doc.status === statusFilter;
      return matchesType && matchesSearch && matchesStatus;
    });
  }, [documents, typeFilter, search, statusFilter]);

  const totalPages = Math.ceil(filteredDocuments.length / itemsPerPage);

  const paginatedDocuments = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredDocuments.slice(start, start + itemsPerPage);
  }, [filteredDocuments, currentPage]);

  const handleCustomerSelect = (custId: string) => {
    const customer = customers.find(c => c.id === custId);
    setFormData(prev => ({
      ...prev,
      customer_id: custId,
      customer_name: (customer?.name || '') as string,
    }));
  };

  const createDocument = async () => {
    if (!formData.customer_name || formData.items.length === 0) {
      toast.error('Completá los datos obligatorios (cliente y productos)');
      return;
    }

    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          document_type: typeFilter,
          customer_id: formData.customer_id || undefined,
          customer_name: formData.customer_name,
          supplier_name: formData.supplier_name || undefined,
          notes: formData.notes || undefined,
          valid_until: formData.valid_until || undefined,
          delivery_date: formData.delivery_date || undefined,
          items: formData.items,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al crear documento');

      toast.success('Documento creado exitosamente');
      setShowCreateForm(false);
      resetForm();

      const { data: { session: s2 } } = await supabase.auth.getSession();
      const h2 = {
        ...(s2?.access_token ? { Authorization: `Bearer ${s2.access_token}` } : {}),
      };
      const docsRes = await fetch('/api/documents', { headers: h2 });
      if (docsRes.ok) setDocuments(await docsRes.json());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al crear documento');
    } finally {
      setCreating(false);
    }
  };

  const updateDocumentStatus = async (docId: string, newStatus: DocumentStatus) => {
    const doc = documents.find(d => d.id === docId);
    if (!doc) return;

    const validStatuses = VALID_STATUSES_PER_TYPE[doc.document_type];
    if (!validStatuses.includes(newStatus)) {
      toast.error(`No se puede cambiar a estado "${DOCUMENT_STATUS_LABELS[newStatus]}"`);
      return;
    }

    const confirmMessages: Record<DocumentStatus, string> = {
      pending: '¿Marcar como pendiente?',
      approved: '¿Aprobar este documento?',
      rejected: '¿Rechazar este documento?',
      completed: '¿Marcar como completado?',
      cancelled: '¿Cancelar este documento?',
    };

    const isDanger = newStatus === 'cancelled' || newStatus === 'rejected';

    setConfirmModal({
      open: true,
      title: DOCUMENT_STATUS_LABELS[newStatus],
      message: confirmMessages[newStatus],
      variant: isDanger ? 'danger' : 'default',
      confirmLabel: DOCUMENT_STATUS_LABELS[newStatus],
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, open: false }));
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(`/api/documents/${docId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({ status: newStatus }),
          });

          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Error al actualizar documento');
          }

          toast.success(`Documento actualizado a ${DOCUMENT_STATUS_LABELS[newStatus]}`);

          const { data: { session: s2 } } = await supabase.auth.getSession();
          const h2 = {
            ...(s2?.access_token ? { Authorization: `Bearer ${s2.access_token}` } : {}),
          };
          const docsRes = await fetch('/api/documents', { headers: h2 });
          if (docsRes.ok) setDocuments(await docsRes.json());
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : 'Error al actualizar documento');
        }
      },
    });
  };

  const deleteDocument = async (docId: string) => {
    setConfirmModal({
      open: true,
      title: 'Eliminar documento',
      message: '¿Eliminar este documento? Esta acción no se puede deshacer.',
      variant: 'danger',
      confirmLabel: 'Eliminar',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, open: false }));
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(`/api/documents/${docId}`, {
            method: 'DELETE',
            headers: {
              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            },
          });

          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Error al eliminar documento');
          }

          toast.success('Documento eliminado');

          const { data: { session: s2 } } = await supabase.auth.getSession();
          const h2 = {
            ...(s2?.access_token ? { Authorization: `Bearer ${s2.access_token}` } : {}),
          };
          const docsRes = await fetch('/api/documents', { headers: h2 });
          if (docsRes.ok) setDocuments(await docsRes.json());
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : 'Error al eliminar documento');
        }
      },
    });
  };

  const resetForm = () => {
    setFormData({
      document_type: typeFilter,
      customer_id: '',
      customer_name: '',
      supplier_name: '',
      notes: '',
      valid_until: '',
      delivery_date: '',
      items: [],
    });
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [
        ...prev.items,
        { description: '', quantity: 1, unit_price_cents: 0 },
      ],
    }));
  };

  const addItemFromProduct = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    setFormData(prev => ({
      ...prev,
      items: [
        ...prev.items,
        {
          product_id: product.id,
          description: product.name,
          quantity: 1,
          unit_price_cents: Math.round((product.price || 0) * 100),
        },
      ],
    }));
  };

  const updateItem = (index: number, field: keyof DocumentItem, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) => {
        if (i !== index) return item;
        if (field === 'quantity') return { ...item, quantity: Math.max(1, Number(value) || 1) };
        if (field === 'unit_price_cents') return { ...item, unit_price_cents: Math.max(0, Math.round((Number(value) || 0) * 100)) };
        return { ...item, [field]: value };
      }),
    }));
  };

  const removeItem = (index: number) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const printDocument = (doc: CommercialDocument) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const businessName = tenant?.razon_social || tenant?.name || 'Mi Negocio';
    const businessCuit = tenant?.cuit || '';
    const businessAddress = [tenant?.business_address, tenant?.business_city, tenant?.business_province].filter(Boolean).join(', ');
    const businessPhone = tenant?.business_phone || '';
    const businessEmail = tenant?.business_email || '';

    const itemsHtml = doc.items?.map(item => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.description}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">$${(item.unit_price_cents / 100).toFixed(2)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">$${(item.subtotal_cents / 100).toFixed(2)}</td>
      </tr>
    `).join('') || '';

    const statusLabel = DOCUMENT_STATUS_LABELS[doc.status];
    const typeLabel = getDocumentTypeLabel(doc.document_type);

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${typeLabel} N° ${String(doc.document_number).padStart(6, '0')}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
          .business-info { flex: 1; }
          .business-name { font-size: 20px; font-weight: bold; margin-bottom: 4px; }
          .business-detail { font-size: 11px; color: #666; margin: 2px 0; }
          .doc-info { text-align: right; }
          .title { font-size: 22px; font-weight: bold; }
          .doc-number { font-size: 14px; color: #666; margin-top: 5px; }
          .status { background: #f0f0f0; padding: 4px 12px; border-radius: 4px; font-size: 12px; display: inline-block; margin-top: 8px; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
          .info-section h3 { font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 8px; }
          .info-section p { margin: 4px 0; font-size: 14px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { background: #f5f5f5; padding: 8px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666; }
          .total-section { display: flex; justify-content: flex-end; margin-top: 20px; }
          .total-box { border-top: 2px solid #333; padding-top: 10px; text-align: right; }
          .total-label { font-size: 14px; color: #666; }
          .total-amount { font-size: 24px; font-weight: bold; color: #16a34a; }
          .notes { margin-top: 30px; padding: 15px; background: #f9f9f9; border-radius: 4px; }
          .notes h3 { font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 8px; }
          .notes p { font-size: 14px; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 11px; color: #999; text-align: center; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="business-info">
            <div class="business-name">${businessName}</div>
            ${businessCuit ? `<div class="business-detail">CUIT: ${businessCuit}</div>` : ''}
            ${businessAddress ? `<div class="business-detail">${businessAddress}</div>` : ''}
            ${businessPhone ? `<div class="business-detail">Tel: ${businessPhone}</div>` : ''}
            ${businessEmail ? `<div class="business-detail">${businessEmail}</div>` : ''}
          </div>
          <div class="doc-info">
            <div class="title">${typeLabel}</div>
            <div class="doc-number">N° ${String(doc.document_number).padStart(6, '0')}</div>
            <div class="status">${statusLabel}</div>
          </div>
        </div>

        <div class="info-grid">
          <div class="info-section">
            <h3>${(doc.document_type === 'remito_ingreso' || doc.document_type === 'orden_compra') ? 'Proveedor' : 'Cliente'}</h3>
            <p><strong>${doc.customer_name}</strong></p>
          </div>
          <div class="info-section">
            <h3>Fecha</h3>
            <p>${new Date(doc.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
            ${doc.delivery_date ? `<p><strong>Entrega:</strong> ${new Date(doc.delivery_date).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}</p>` : ''}
            ${doc.valid_until ? `<p><strong>Válido hasta:</strong> ${new Date(doc.valid_until).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}</p>` : ''}
            ${doc.supplier_name ? `<p><strong>Proveedor:</strong> ${doc.supplier_name}</p>` : ''}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Descripción</th>
              <th style="text-align: center;">Cantidad</th>
              <th style="text-align: right;">P. Unitario</th>
              <th style="text-align: right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="total-section">
          <div class="total-box">
            <div class="total-label">TOTAL</div>
            <div class="total-amount">$${(doc.total_cents / 100).toFixed(2)}</div>
          </div>
        </div>

        ${doc.notes ? `
          <div class="notes">
            <h3>Observaciones</h3>
            <p>${doc.notes}</p>
          </div>
        ` : ''}

        <div class="footer">
          ${typeLabel} N° ${String(doc.document_number).padStart(6, '0')} - Generado el ${new Date().toLocaleDateString('es-ES')}
        </div>
      </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.print();
  };

  const toggleRow = (docId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  const statusBadge = (status: DocumentStatus) => (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${DOCUMENT_STATUS_COLORS[status]}`}>
      {DOCUMENT_STATUS_LABELS[status]}
    </span>
  );

  const getDocumentTypeLabel = (type: DocumentType) => DOCUMENT_TYPE_LABELS[type];

  const getNextStatuses = (doc: DocumentType, currentStatus: DocumentStatus): DocumentStatus[] => {
    const valid = VALID_STATUSES_PER_TYPE[doc];
    return valid.filter(s => s !== currentStatus);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <FileText className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
            Documentos Comerciales
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Gestión de remitos, presupuestos y órdenes
          </p>
        </div>
        <Button onClick={() => { setShowCreateForm(!showCreateForm); resetForm(); }} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          {showCreateForm ? 'Cancelar' : 'Nuevo Documento'}
        </Button>
      </div>

      {showCreateForm && (
        <Card className="p-6 border border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-indigo-600" />
            Nuevo {getDocumentTypeLabel(typeFilter)}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800 pt-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              {(typeFilter === 'remito_ingreso' || typeFilter === 'orden_compra') ? 'Datos del Proveedor' : 'Datos del Cliente'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {(typeFilter === 'remito_ingreso' || typeFilter === 'orden_compra') ? 'Proveedor existente' : 'Cliente existente'}
                </label>
                {(typeFilter === 'remito_ingreso' || typeFilter === 'orden_compra') ? (
                  <Select value={formData.supplier_name || ''} onChange={e => {
                    const supplier = suppliers.find(s => s.name === e.target.value);
                    setFormData(prev => ({
                      ...prev,
                      supplier_name: supplier?.name || e.target.value,
                      customer_name: supplier?.name || e.target.value,
                    }));
                  }}>
                    <option value="">Seleccionar proveedor...</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                  </Select>
                ) : (
                  <Select value={formData.customer_id || ''} onChange={e => handleCustomerSelect(e.target.value)}>
                    <option value="">Seleccionar cliente...</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name} {c.cuit ? `- ${c.cuit}` : ''}</option>
                    ))}
                  </Select>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre *</label>
                <Input
                  value={(typeFilter === 'remito_ingreso' || typeFilter === 'orden_compra') ? (formData.supplier_name || '') : formData.customer_name}
                  onChange={e => setFormData(prev => ({
                    ...prev,
                    customer_name: e.target.value,
                    supplier_name: (typeFilter === 'remito_ingreso' || typeFilter === 'orden_compra') ? e.target.value : prev.supplier_name,
                  }))}
                  placeholder={(typeFilter === 'remito_ingreso' || typeFilter === 'orden_compra') ? 'Nombre del proveedor' : 'Razón social o nombre'}
                />
              </div>
            </div>
          </div>

          {(typeFilter === 'presupuesto' || typeFilter === 'remito_salida' || typeFilter === 'remito_ingreso') && (
            <div className="border-t border-gray-100 dark:border-gray-800 pt-4 mb-4">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Fechas</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {typeFilter === 'presupuesto' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Válido hasta</label>
                    <Input
                      type="date"
                      value={formData.valid_until || ''}
                      onChange={e => setFormData(prev => ({ ...prev, valid_until: e.target.value }))}
                    />
                  </div>
                )}
                {(typeFilter === 'remito_salida' || typeFilter === 'remito_ingreso') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha de entrega</label>
                    <Input
                      type="date"
                      value={formData.delivery_date || ''}
                      onChange={e => setFormData(prev => ({ ...prev, delivery_date: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 dark:border-gray-800 pt-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Items</h3>
              <div className="flex items-center gap-2">
                {products.length > 0 && (
                  <Select
                    value=""
                    onChange={e => {
                      if (e.target.value) {
                        addItemFromProduct(e.target.value);
                        e.target.value = '';
                      }
                    }}
                    className="text-xs"
                  >
                    <option value="">+ Agregar producto...</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} - ${(p.price || 0).toFixed(2)}
                      </option>
                    ))}
                  </Select>
                )}
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Agregar item
                </Button>
              </div>
            </div>

            {formData.items.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">
                {formData.sale_id ? 'La venta seleccionada no tiene items' : 'Agregá items haciendo clic en "Agregar item" o seleccionando un producto'}
              </p>
            ) : (
              <div className="space-y-2">
                {formData.items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <div className="sm:col-span-2">
                        <Input
                          placeholder="Descripción del producto"
                          value={item.description}
                          onChange={e => updateItem(i, 'description', e.target.value)}
                          className="text-sm"
                        />
                      </div>
                      <div>
                        <Input
                          type="number"
                          min="1"
                          placeholder="Cant."
                          value={item.quantity}
                          onChange={e => updateItem(i, 'quantity', e.target.value)}
                          className="text-sm"
                        />
                      </div>
                      <div>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Precio unitario"
                          value={(item.unit_price_cents / 100).toFixed(2)}
                          onChange={e => updateItem(i, 'unit_price_cents', e.target.value)}
                          className="text-sm"
                        />
                      </div>
                    </div>
                    <div className="text-right text-sm font-medium text-gray-900 dark:text-gray-100 w-24">
                      ${((item.unit_price_cents * item.quantity) / 100).toFixed(2)}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      className="text-red-500 hover:text-red-700 p-1"
                      title="Eliminar item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <div className="flex justify-end pt-2">
                  <div className="text-right">
                    <span className="text-sm text-gray-500">Total: </span>
                    <span className="text-lg font-bold text-green-600 dark:text-green-400">
                      ${(formData.items.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0) / 100).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800 pt-4 mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas (opcional)</label>
            <textarea
              value={formData.notes || ''}
              onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Observaciones adicionales..."
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
            <Button variant="outline" onClick={() => { setShowCreateForm(false); resetForm(); }}>Cancelar</Button>
            <Button onClick={createDocument} disabled={creating} className="flex items-center gap-2">
              {creating ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Creando...</>
              ) : (
                <><Check className="h-4 w-4" /> Crear {getDocumentTypeLabel(typeFilter)}</>
              )}
            </Button>
          </div>
        </Card>
      )}

      <Card className="border border-gray-100 dark:border-gray-800">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500">Tipo:</span>
              {Object.entries(DOCUMENT_TYPE_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => { setTypeFilter(key as DocumentType); setCurrentPage(1); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    typeFilter === key
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Buscar..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                  className="pl-9 w-48"
                />
              </div>
              <Select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }} className="w-36">
                <option value="all">Todos</option>
                {VALID_STATUSES_PER_TYPE[typeFilter].map(status => (
                  <option key={status} value={status}>{DOCUMENT_STATUS_LABELS[status]}</option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-gray-500">No se encontraron {getDocumentTypeLabel(typeFilter).toLowerCase()}s</p>
            <Button onClick={() => { setShowCreateForm(true); resetForm(); }} className="mt-4" variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-1" /> Crear primer {getDocumentTypeLabel(typeFilter).toLowerCase()}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4 w-8"></th>
                  <th className="py-3 px-4">Nro.</th>
                  <th className="py-3 px-4">{(typeFilter === 'remito_ingreso' || typeFilter === 'orden_compra') ? 'Proveedor' : 'Cliente'}</th>
                  <th className="py-3 px-4 text-right">Total</th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-4 text-right">Fecha</th>
                  <th className="py-3 px-4 text-right">Vencimiento</th>
                  <th className="py-3 px-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                {paginatedDocuments.map(doc => (
                  <React.Fragment key={doc.id}>
                    <tr
                      className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 cursor-pointer"
                      onClick={() => toggleRow(doc.id)}
                    >
                      <td className="py-3 px-4">
                        {expandedRows.has(doc.id) ? (
                          <ChevronUp className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-gray-500">
                        {String(doc.document_number).padStart(6, '0')}
                      </td>
                      <td className="py-3 px-4 text-gray-900 dark:text-gray-100 max-w-[200px] truncate">
                        {doc.customer_name}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-green-600 dark:text-green-400">
                        ${(doc.total_cents / 100).toFixed(2)}
                      </td>
                      <td className="py-3 px-4">{statusBadge(doc.status)}</td>
                      <td className="py-3 px-4 text-right text-xs text-gray-500 whitespace-nowrap">
                        {new Date(doc.created_at).toLocaleDateString('es-ES', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                        })}
                      </td>
                      <td className="py-3 px-4 text-right text-xs whitespace-nowrap">
                        {doc.valid_until ? (
                          <span className={
                            new Date(doc.valid_until) < new Date()
                              ? 'text-red-600 dark:text-red-400 font-medium'
                              : 'text-gray-500'
                          }>
                            {new Date(doc.valid_until).toLocaleDateString('es-ES', {
                              day: '2-digit', month: '2-digit', year: 'numeric',
                            })}
                          </span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                          {doc.status !== 'cancelled' && doc.status !== 'completed' && (
                            <>
                              {VALID_STATUSES_PER_TYPE[doc.document_type]
                                .filter(s => s !== doc.status && s !== 'cancelled')
                                .slice(0, 2)
                                .map(status => (
                                  <button
                                    key={status}
                                    onClick={() => updateDocumentStatus(doc.id, status)}
                                    className={`text-xs px-2 py-1 rounded ${
                                      status === 'approved' || status === 'completed'
                                        ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
                                        : status === 'rejected'
                                        ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
                                        : 'text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                                    }`}
                                    title={DOCUMENT_STATUS_LABELS[status]}
                                  >
                                    {status === 'approved' ? '✓' : status === 'completed' ? '✓✓' : status === 'rejected' ? '✗' : '·'}
                                  </button>
                                ))}
                            </>
                          )}
                          <button
                            onClick={() => deleteDocument(doc.id)}
                            className="text-red-500 hover:text-red-700 p-1"
                            title="Eliminar"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => printDocument(doc)}
                            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 p-1"
                            title="Imprimir"
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedRows.has(doc.id) && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <div className={`border-l-4 ${DOCUMENT_TYPE_COLORS[doc.document_type].border} ${DOCUMENT_TYPE_COLORS[doc.document_type].bg} mx-4 my-2 rounded-lg overflow-hidden`}>
                            <div className="px-6 py-4">
                              <div className="flex items-start justify-between mb-4">
                                <div>
                                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                                    {getDocumentTypeLabel(doc.document_type)} #{String(doc.document_number).padStart(6, '0')}
                                  </h3>
                                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{doc.customer_name}</p>
                                  <p className="text-xs text-gray-500 mt-1">
                                    {new Date(doc.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
                                  </p>
                                </div>
                                <div className="text-right">
                                  {statusBadge(doc.status)}
                                  <p className="text-xl font-bold text-green-600 dark:text-green-400 mt-2">
                                    ${(doc.total_cents / 100).toFixed(2)}
                                  </p>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                                <div className="space-y-1">
                                  {doc.supplier_name && <p className="text-sm"><span className="text-gray-500">Proveedor:</span> <span className="text-gray-900 dark:text-gray-100">{doc.supplier_name}</span></p>}
                                  {doc.valid_until && (
                                    <p className="text-sm">
                                      <span className="text-gray-500">Válido hasta:</span>{' '}
                                      <span className={
                                        new Date(doc.valid_until) < new Date()
                                          ? 'text-red-600 dark:text-red-400 font-medium'
                                          : 'text-gray-900 dark:text-gray-100'
                                      }>
                                        {new Date(doc.valid_until).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
                                      </span>
                                    </p>
                                  )}
                                  {doc.delivery_date && <p className="text-sm"><span className="text-gray-500">Fecha entrega:</span> <span className="text-gray-900 dark:text-gray-100">{new Date(doc.delivery_date).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}</span></p>}
                                  {doc.notes && <p className="text-sm"><span className="text-gray-500">Notas:</span> <span className="text-gray-900 dark:text-gray-100">{doc.notes}</span></p>}
                                </div>
                                <div>
                                  {doc.items && doc.items.length > 0 ? (
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="text-xs text-gray-500 border-b border-gray-200 dark:border-gray-700">
                                          <th className="text-left py-1.5">Descripción</th>
                                          <th className="text-right py-1.5">Cant.</th>
                                          <th className="text-right py-1.5">P. Unit.</th>
                                          <th className="text-right py-1.5">Subtotal</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {doc.items.map((item) => (
                                          <tr key={item.id} className="border-t border-gray-100 dark:border-gray-800">
                                            <td className="py-1.5 text-gray-900 dark:text-gray-100">{item.description}</td>
                                            <td className="py-1.5 text-right text-gray-600 dark:text-gray-400">{item.quantity}</td>
                                            <td className="py-1.5 text-right text-gray-600 dark:text-gray-400">${(item.unit_price_cents / 100).toFixed(2)}</td>
                                            <td className="py-1.5 text-right font-medium text-gray-900 dark:text-gray-100">${(item.subtotal_cents / 100).toFixed(2)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <p className="text-sm text-gray-400">Sin items</p>
                                  )}
                                </div>
                              </div>

                              {doc.status !== 'cancelled' && doc.status !== 'completed' && (
                                <div className="flex gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                                  {getNextStatuses(doc.document_type, doc.status).map(status => (
                                    <Button
                                      key={status}
                                      variant="outline"
                                      size="sm"
                                      onClick={() => updateDocumentStatus(doc.id, status)}
                                      className={
                                        status === 'approved' || status === 'completed'
                                          ? 'text-green-600 border-green-200 hover:bg-green-50 dark:border-green-800 dark:hover:bg-green-900/20'
                                          : status === 'rejected'
                                          ? 'text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20'
                                          : ''
                                      }
                                    >
                                      {DOCUMENT_STATUS_LABELS[status]}
                                    </Button>
                                  ))}
                                </div>
                              )}
                            </div>
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

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800 px-6 py-4">
            <span className="text-xs text-gray-500">
              Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong>
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              >
                Anterior
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                .reduce<(number | '...')[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === '...' ? (
                    <span key={`dots-${i}`} className="px-1 text-gray-400 text-xs">…</span>
                  ) : (
                    <Button
                      key={p}
                      variant={currentPage === p ? 'primary' : 'outline'}
                      size="sm"
                      onClick={() => setCurrentPage(p)}
                      className="min-w-[28px] px-1"
                    >
                      {p}
                    </Button>
                  )
                )}
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        confirmLabel={confirmModal.confirmLabel}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, open: false }))}
      />
    </div>
  );
}
