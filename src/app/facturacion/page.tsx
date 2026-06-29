'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import toast from 'react-hot-toast';
import {
  FileText,
  Plus,
  Loader2,
  Search,
  Check,
  X,
  AlertCircle,
  Ban,
  Receipt,
} from 'lucide-react';
import type { ElectronicInvoice, InvoiceType, IvaCondition, DocumentType } from '@/lib/types/invoice';
import { INVOICE_TYPE_LABELS, IVA_CONDITION_LABELS, DOCUMENT_TYPE_LABELS } from '@/lib/types/invoice';
import type { Customer } from '@/lib/types/sale';

interface SaleRecord {
  id: string;
  total_cents: number;
  customer_name?: string;
  customer_id?: string;
  created_at: string;
  status: string;
  items: { product_id: string; product_name?: string; quantity: number; unit_price_cents: number; subtotal_cents: number }[];
}

export default function FacturacionPage() {
  const { tenant } = useAuth();

  const [invoices, setInvoices] = useState<ElectronicInvoice[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<ElectronicInvoice | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [creating, setCreating] = useState(false);

  const [formData, setFormData] = useState({
    sale_id: '',
    invoice_type: 'B' as InvoiceType,
    customer_id: '',
    customer_name: '',
    document_type: 'DNI' as DocumentType,
    document_number: '',
    iva_condition: 'consumidor_final' as IvaCondition,
    cuit_receptor: '',
    items: [] as { product_id: string; description: string; quantity: number; unit_price_cents: number }[],
  });

  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = {
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };

      const [invRes, salesRes, custRes] = await Promise.all([
        fetch('/api/invoices', { headers }),
        fetch('/api/sales', { headers }),
        fetch('/api/customers', { headers }),
      ]);

      if (cancelled) return;
      if (invRes.ok) setInvoices(await invRes.json());
      if (salesRes.ok) {
        const allSales: SaleRecord[] = await salesRes.json();
        setSales(allSales.filter(s => s.status === 'completed'));
      }
      if (custRes.ok) setCustomers(await custRes.json());
    })().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [tenant?.id]);

  const filteredInvoices = invoices.filter(inv => {
    const matchesSearch = !search ||
      inv.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      inv.cae?.includes(search) ||
      String(inv.invoice_number).includes(search);
    const matchesStatus = statusFilter === 'all' || inv.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const selectSale = (saleId: string) => {
    if (!saleId) {
      setFormData(prev => ({
        ...prev,
        sale_id: '',
        customer_id: '',
        customer_name: '',
        items: [],
      }));
      return;
    }

    const sale = sales.find(s => s.id === saleId);
    if (!sale) return;

    const customer = customers.find(c => c.id === sale.customer_id);

    setFormData(prev => ({
      ...prev,
      sale_id: saleId,
      customer_id: sale.customer_id || '',
      customer_name: (customer?.name || sale.customer_name || '') as string,
      document_type: (customer?.document_type || 'DNI') as DocumentType,
      document_number: customer?.document_number || '',
      iva_condition: (customer?.iva_condition || 'consumidor_final') as IvaCondition,
      cuit_receptor: customer?.cuit || '',
      items: (sale.items || []).map((item: { product_id: string; product_name?: string; quantity: number; unit_price_cents: number }) => ({
        product_id: item.product_id,
        description: item.product_name || 'Producto',
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
      })),
    }));
  };

  const handleCustomerSelect = (custId: string) => {
    const customer = customers.find(c => c.id === custId);
    setFormData(prev => ({
      ...prev,
      customer_id: custId,
      customer_name: (customer?.name || '') as string,
      document_type: (customer?.document_type || 'DNI') as DocumentType,
      document_number: customer?.document_number || '',
      iva_condition: (customer?.iva_condition || 'consumidor_final') as IvaCondition,
      cuit_receptor: customer?.cuit || '',
    }));
  };

  const createInvoice = async () => {
    if (!formData.customer_name || formData.items.length === 0) {
      toast.error('Completá los datos obligatorios (cliente y productos)');
      return;
    }

    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          sale_id: formData.sale_id || undefined,
          invoice_type: formData.invoice_type,
          customer_id: formData.customer_id || undefined,
          customer_name: formData.customer_name,
          document_type: formData.document_type,
          document_number: formData.document_number,
          iva_condition: formData.iva_condition,
          cuit_receptor: formData.cuit_receptor || undefined,
          items: formData.items,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al generar factura');

      toast.success('Factura electrónica generada exitosamente');
      setShowCreateForm(false);
      setFormData({
        sale_id: '',
        invoice_type: 'B',
        customer_id: '',
        customer_name: '',
        document_type: 'DNI',
        document_number: '',
        iva_condition: 'consumidor_final',
        cuit_receptor: '',
        items: [],
      });

      const { data: { session: s2 } } = await supabase.auth.getSession();
      const h2 = {
        ...(s2?.access_token ? { Authorization: `Bearer ${s2.access_token}` } : {}),
      };
      const invRes = await fetch('/api/invoices', { headers: h2 });
      if (invRes.ok) setInvoices(await invRes.json());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al generar factura');
    } finally {
      setCreating(false);
    }
  };

  const cancelInvoice = async (invoiceId: string) => {
    if (!confirm('¿Anular esta factura electrónica? Esta acción no se puede deshacer.')) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ status: 'cancelled' }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al anular factura');
      }

      toast.success('Factura anulada');

      const { data: { session: s2 } } = await supabase.auth.getSession();
      const h2 = {
        ...(s2?.access_token ? { Authorization: `Bearer ${s2.access_token}` } : {}),
      };
      const invRes = await fetch('/api/invoices', { headers: h2 });
      if (invRes.ok) setInvoices(await invRes.json());
      setSelectedInvoice(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al anular factura');
    }
  };

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    };
    const labels: Record<string, string> = {
      approved: 'Aprobada',
      rejected: 'Rechazada',
      pending: 'Pendiente',
      cancelled: 'Anulada',
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <FileText className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
            Facturación Electrónica
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Generá y gestioná facturas electrónicas con AFIP
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(!showCreateForm)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          {showCreateForm ? 'Cancelar' : 'Nueva Factura'}
        </Button>
      </div>

      {showCreateForm && (
        <Card className="p-6 border border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Receipt className="h-5 w-5 text-indigo-600" />
            Nueva Factura Electrónica
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Venta asociada (opcional)</label>
              <Select value={formData.sale_id} onChange={e => selectSale(e.target.value)}>
                <option value="">Sin venta asociada</option>
                {sales.map(s => (
                  <option key={s.id} value={s.id}>
                    #{s.id.slice(0, 8)} - {s.customer_name || 'Mostrador'} - ${(s.total_cents / 100).toFixed(2)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de comprobante</label>
              <Select value={formData.invoice_type} onChange={e => setFormData(prev => ({ ...prev, invoice_type: e.target.value as InvoiceType }))}>
                {Object.entries(INVOICE_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800 pt-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Datos del Cliente</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cliente existente</label>
                <Select value={formData.customer_id} onChange={e => handleCustomerSelect(e.target.value)}>
                  <option value="">Seleccionar cliente...</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name} {c.cuit ? `- ${c.cuit}` : ''}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre *</label>
                <Input
                  value={formData.customer_name}
                  onChange={e => setFormData(prev => ({ ...prev, customer_name: e.target.value }))}
                  placeholder="Razón social o nombre"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo documento</label>
                <Select value={formData.document_type} onChange={e => setFormData(prev => ({ ...prev, document_type: e.target.value as DocumentType }))}>
                  {Object.entries(DOCUMENT_TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nro. documento</label>
                <Input
                  value={formData.document_number}
                  onChange={e => setFormData(prev => ({ ...prev, document_number: e.target.value }))}
                  placeholder="DNI / CUIT"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Condición IVA</label>
                <Select value={formData.iva_condition} onChange={e => setFormData(prev => ({ ...prev, iva_condition: e.target.value as IvaCondition }))}>
                  {Object.entries(IVA_CONDITION_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CUIT Receptor (Factura A)</label>
                <Input
                  value={formData.cuit_receptor}
                  onChange={e => setFormData(prev => ({ ...prev, cuit_receptor: e.target.value }))}
                  placeholder="11-22222222-3"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800 pt-4 mb-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Items</h3>
            {formData.items.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">
                {formData.sale_id ? 'La venta seleccionada no tiene items' : 'Seleccioná una venta o agregá items manualmente'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 uppercase">
                      <th className="py-2 px-3 text-left">Producto</th>
                      <th className="py-2 px-3 text-right">Cant.</th>
                      <th className="py-2 px-3 text-right">P. Unit.</th>
                      <th className="py-2 px-3 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                    {formData.items.map((item, i) => (
                      <tr key={i}>
                        <td className="py-2 px-3 text-gray-900 dark:text-gray-100">{item.description}</td>
                        <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">{item.quantity}</td>
                        <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">${(item.unit_price_cents / 100).toFixed(2)}</td>
                        <td className="py-2 px-3 text-right font-medium text-gray-900 dark:text-gray-100">${((item.unit_price_cents * item.quantity) / 100).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
            <Button variant="outline" onClick={() => setShowCreateForm(false)}>Cancelar</Button>
            <Button onClick={createInvoice} disabled={creating} className="flex items-center gap-2">
              {creating ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Generando...</>
              ) : (
                <><Check className="h-4 w-4" /> Generar Factura Electrónica</>
              )}
            </Button>
          </div>
        </Card>
      )}

      <Card className="border border-gray-100 dark:border-gray-800">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Buscar factura..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Estado:</span>
              <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-36">
                <option value="all">Todas</option>
                <option value="approved">Aprobadas</option>
                <option value="pending">Pendientes</option>
                <option value="rejected">Rechazadas</option>
                <option value="cancelled">Anuladas</option>
              </Select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-gray-500">No se encontraron facturas electrónicas</p>
            <Button onClick={() => setShowCreateForm(true)} className="mt-4" variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-1" /> Crear primera factura
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Factura</th>
                  <th className="py-3 px-4">Cliente</th>
                  <th className="py-3 px-4">Tipo</th>
                  <th className="py-3 px-4 text-right">Total</th>
                  <th className="py-3 px-4">CAE</th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-4 text-right">Fecha</th>
                  <th className="py-3 px-4 text-center">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                {filteredInvoices.map(inv => (
                  <tr
                    key={inv.id}
                    className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 cursor-pointer"
                    onClick={() => setSelectedInvoice(selectedInvoice?.id === inv.id ? null : inv)}
                  >
                    <td className="py-3 px-4 font-mono text-xs text-gray-500">
                      {String(inv.punto_venta).padStart(4, '0')}-{String(inv.invoice_number).padStart(8, '0')}
                    </td>
                    <td className="py-3 px-4 text-gray-900 dark:text-gray-100 max-w-[200px] truncate">
                      {inv.customer_name}
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-500">
                      {INVOICE_TYPE_LABELS[inv.invoice_type] || inv.invoice_type}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-green-600 dark:text-green-400">
                      ${(inv.total_cents / 100).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-gray-500">
                      {inv.cae || '-'}
                    </td>
                    <td className="py-3 px-4">{statusBadge(inv.status)}</td>
                    <td className="py-3 px-4 text-right text-xs text-gray-500 whitespace-nowrap">
                      {new Date(inv.created_at).toLocaleDateString('es-ES', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {inv.status === 'approved' && (
                        <button
                          onClick={e => { e.stopPropagation(); cancelInvoice(inv.id); }}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Anular factura"
                        >
                          <Ban className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selectedInvoice && (
        <Card className="border border-gray-100 dark:border-gray-800">
          <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-600" />
              Factura {String(selectedInvoice.punto_venta).padStart(4, '0')}-{String(selectedInvoice.invoice_number).padStart(8, '0')}
            </h2>
            {statusBadge(selectedInvoice.status)}
          </div>

          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Emisor</h3>
              <div>
                <p className="text-xs text-gray-400">CUIT</p>
                <p className="text-sm font-mono text-gray-900 dark:text-gray-100">{selectedInvoice.cuit_emisor}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Punto de Venta</p>
                <p className="text-sm font-mono text-gray-900 dark:text-gray-100">{String(selectedInvoice.punto_venta).padStart(4, '0')}</p>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Receptor</h3>
              <div>
                <p className="text-xs text-gray-400">Nombre</p>
                <p className="text-sm text-gray-900 dark:text-gray-100">{selectedInvoice.customer_name}</p>
              </div>
              {selectedInvoice.document_number && (
                <div>
                  <p className="text-xs text-gray-400">{DOCUMENT_TYPE_LABELS[selectedInvoice.document_type] || selectedInvoice.document_type}</p>
                  <p className="text-sm font-mono text-gray-900 dark:text-gray-100">{selectedInvoice.document_number}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-400">Condición IVA</p>
                <p className="text-sm text-gray-900 dark:text-gray-100">{IVA_CONDITION_LABELS[selectedInvoice.iva_condition]}</p>
              </div>
            </div>
          </div>

          <div className="px-4 pb-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Items</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 uppercase">
                    <th className="py-2 px-3 text-left">Descripción</th>
                    <th className="py-2 px-3 text-right">Cant.</th>
                    <th className="py-2 px-3 text-right">P. Unit.</th>
                    <th className="py-2 px-3 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {(selectedInvoice.items || []).map((item, i) => (
                    <tr key={i}>
                      <td className="py-2 px-3 text-gray-900 dark:text-gray-100">{item.description}</td>
                      <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">{item.quantity}</td>
                      <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">${(item.unit_price_cents / 100).toFixed(2)}</td>
                      <td className="py-2 px-3 text-right font-medium text-gray-900 dark:text-gray-100">${(item.subtotal_cents / 100).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800 pt-4">
            <div className="flex justify-end">
              <div className="w-64 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Neto</span>
                  <span className="text-gray-900 dark:text-gray-100">${(selectedInvoice.net_cents / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">IVA {selectedInvoice.iva_percentage}%</span>
                  <span className="text-gray-900 dark:text-gray-100">${(selectedInvoice.iva_cents / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold pt-1 border-t border-gray-100 dark:border-gray-800">
                  <span className="text-gray-900 dark:text-gray-100">Total</span>
                  <span className="text-green-600 dark:text-green-400">${(selectedInvoice.total_cents / 100).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {selectedInvoice.status === 'approved' && selectedInvoice.cae && (
            <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800 pt-4">
              <div className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="h-5 w-5 text-green-600" />
                  <h3 className="font-semibold text-green-800 dark:text-green-400">Comprobante Autorizado por AFIP</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-green-600 dark:text-green-500">CAE</p>
                    <p className="font-mono font-bold text-green-800 dark:text-green-300 text-lg">{selectedInvoice.cae}</p>
                  </div>
                  <div>
                    <p className="text-xs text-green-600 dark:text-green-500">Vencimiento CAE</p>
                    <p className="font-mono text-green-800 dark:text-green-300">
                      {selectedInvoice.cae_due_date
                        ? new Date(selectedInvoice.cae_due_date).toLocaleDateString('es-ES')
                        : '-'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedInvoice.status === 'cancelled' && (
            <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800 pt-4">
              <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-2">
                <X className="h-5 w-5 text-red-500" />
                <p className="text-sm text-red-700 dark:text-red-400">Esta factura fue anulada</p>
              </div>
            </div>
          )}

          {selectedInvoice.status === 'rejected' && (
            <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800 pt-4">
              <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-red-500" />
                <p className="text-sm text-red-700 dark:text-red-400">La factura fue rechazada por AFIP</p>
              </div>
            </div>
          )}

          {selectedInvoice.status === 'approved' && (
            <div className="px-4 pb-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
                onClick={() => cancelInvoice(selectedInvoice.id)}
              >
                <Ban className="h-4 w-4 mr-1" /> Anular Factura
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
