'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { canUseFacturacion } from '@/lib/arca/access';
import { authFetch } from '@/lib/fetchWithTenant';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { SearchInput } from '@/components/ui/search-input';
import { Tooltip } from '@/components/ui/tooltip';
import { Thead, Th } from '@/components/ui/table-header';
import { FormLabel } from '@/components/ui/form-label';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { usePagination } from '@/lib/hooks/usePagination';
import {
  FileText,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Printer,
  QrCode,
  Building2,
  DollarSign,
  Settings,
  Trash2,
  Ban,
  Receipt,
  FlaskConical,
} from 'lucide-react';
import { formatARS } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/format';
import { matchesQuery } from '@/lib/utils/text';
import { cn } from '@/lib/utils/cn';
import { validateFacturaReceptor } from '@/lib/arca/validation';
import toast from 'react-hot-toast';
import type { ElectronicInvoiceRecord, ArcaConfig } from '@/lib/types/arca';
import type { Customer } from '@/lib/types/sale';
import type { Product } from '@/lib/types/product';
import {
  InvoiceDocument,
  PrintInvoice,
  voucherDisplayName,
  type InvoicePaperSize,
  type InvoiceTenant,
} from '@/components/arca/invoice-document';

// Tipos de comprobante que se pueden emitir desde el modal (facturas + NC).
type VoucherType = 'A' | 'B' | 'C' | 'NC_A' | 'NC_B' | 'NC_C';

export default function FacturacionPage() {
  const { tenant, profile, loading: authLoading } = useAuth();
  const tenantIvaCondition = tenant?.iva_condition;
  const router = useRouter();
  // Feature en pruebas: por ahora sólo accesible para la cuenta admin. Se oculta
  // en el sidebar y acá se corta el acceso directo por URL.
  const canInvoice = canUseFacturacion(profile, tenant);

  const [country] = useState<'AR' | string>(() => {
    if (typeof document === 'undefined') return 'AR';
    try {
      const match = document.cookie.match(/(?:^|; )vynko_country=([^;]+)/);
      return match ? decodeURIComponent(match[1]).toUpperCase().slice(0, 2) : 'AR';
    } catch {
      return 'AR';
    }
  });
  const [invoices, setInvoices] = useState<ElectronicInvoiceRecord[]>([]);
  const [arcaConfig, setArcaConfig] = useState<ArcaConfig | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [paperSize, setPaperSize] = useState<InvoicePaperSize>('a4');

  // Nota de Crédito
  const [ncTarget, setNcTarget] = useState<ElectronicInvoiceRecord | null>(null);
  const [issuingNc, setIssuingNc] = useState(false);

  const tenantForInvoice = (tenant ?? {}) as unknown as InvoiceTenant;

  // Tipos de comprobante válidos según la condición del emisor. Debe reflejar
  // `resolveVoucherType` del backend: un Responsable Inscripto emite serie A/B,
  // cualquier otro emisor (monotributo, exento, no inscripto) sólo serie C.
  const emisorEsResponsableInscripto = !tenantIvaCondition || tenantIvaCondition === 'responsable_inscripto';
  const allowedInvoiceTypes = useMemo<('A' | 'B' | 'C')[]>(
    () => (emisorEsResponsableInscripto ? ['A', 'B'] : ['C']),
    [emisorEsResponsableInscripto]
  );

  // Modal Crear Factura
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<{
    customer_id: string;
    customer_name: string;
    document_type: 'DNI' | 'CUIT' | 'CUIL' | 'SinIdentificar';
    document_number: string;
    iva_condition: 'consumidor_final' | 'responsable_inscripto' | 'monotributista' | 'sujeto_exento';
    invoice_type: VoucherType;
    items: {
      product_id?: string;
      description: string;
      quantity: number;
      unit_price: number; // en pesos
      iva_percentage: number;
    }[];
  }>({
    customer_id: '',
    customer_name: 'Consumidor Final',
    document_type: 'SinIdentificar',
    document_number: '',
    iva_condition: 'consumidor_final',
    invoice_type: 'B',
    items: [{ description: 'Venta de productos', quantity: 1, unit_price: 0, iva_percentage: 21 }],
  });

  // Comprobante original que acredita la Nota de Crédito (cuando se emite desde
  // el modal de creación en lugar del botón "Nota de Crédito" de cada factura).
  const [ncOriginalId, setNcOriginalId] = useState('');
  const isCreditNote = createForm.invoice_type.startsWith('NC_');
  const ncSeriesLetter = isCreditNote ? createForm.invoice_type.slice(3) : null;

  // Facturas (A/B/C según la condición del emisor) + sus Notas de Crédito.
  const voucherOptions = useMemo<{ value: VoucherType; label: string }[]>(() => {
    const facturas = allowedInvoiceTypes.map((t) => ({
      value: t as VoucherType,
      label: t === 'A' ? 'Factura A' : t === 'B' ? 'Factura B' : 'Factura C',
    }));
    const notas = allowedInvoiceTypes.map((t) => ({
      value: `NC_${t}` as VoucherType,
      label: `Nota de Crédito ${t}`,
    }));
    return [...facturas, ...notas];
  }, [allowedInvoiceTypes]);

  // Facturas aprobadas que pueden acreditarse con la NC elegida. Solo se ofrecen
  // del mismo ambiente (sandbox o real) para no cruzar CAE simulados con reales.
  const creditNoteCandidates = useMemo(() => {
    if (!ncSeriesLetter) return [];
    return invoices.filter(
      (inv) =>
        inv.status === 'approved' &&
        !inv.invoice_type.startsWith('NC_') &&
        inv.invoice_type === ncSeriesLetter &&
        Boolean(inv.is_sandbox) === Boolean(arcaConfig?.is_sandbox)
    );
  }, [invoices, ncSeriesLetter, arcaConfig?.is_sandbox]);

  const ncOriginal = useMemo(
    () => creditNoteCandidates.find((inv) => inv.id === ncOriginalId) || null,
    [creditNoteCandidates, ncOriginalId]
  );

  // Modal Ver Factura / QR
  const [selectedInvoice, setSelectedInvoice] = useState<(ElectronicInvoiceRecord & { qr_data_url?: string }) | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [resInvoices, resConfig, resCustomers, resProducts] = await Promise.all([
        authFetch('/api/arca/invoices'),
        authFetch('/api/arca/config'),
        authFetch('/api/customers').catch(() => null),
        authFetch('/api/products').catch(() => null),
      ]);

      if (resInvoices.ok) {
        const invData = await resInvoices.json();
        setInvoices(invData.invoices || []);
      }

      if (resConfig.ok) {
        const cfgData: ArcaConfig = await resConfig.json();
        setArcaConfig(cfgData);
        // Pre-ajustar tipo de factura según condición del emisor
        if (!emisorEsResponsableInscripto) {
          setCreateForm((prev) => ({ ...prev, invoice_type: 'C' }));
        }
      }

      if (resCustomers && resCustomers.ok) {
        const custData = await resCustomers.json();
        setCustomers(custData || []);
      }

      if (resProducts && resProducts.ok) {
        const prodData = await resProducts.json();
        setProducts(prodData || []);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }, [emisorEsResponsableInscripto]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (canInvoice) fetchData();
  }, [fetchData, canInvoice]);

  // Feature en pruebas internas: fuera de la cuenta admin no se puede entrar ni
  // por URL. El guard real de datos lo hace el backend; esto es UX/acceso.
  useEffect(() => {
    if (!authLoading && !canInvoice) router.replace('/dashboard');
  }, [authLoading, canInvoice, router]);

  // Manejo de selección de cliente existente en modal de creación
  const handleSelectCustomer = (customerId: string) => {
    if (!customerId) {
      setCreateForm((prev) => ({
        ...prev,
        customer_id: '',
        customer_name: 'Consumidor Final',
        document_type: 'SinIdentificar',
        document_number: '',
        iva_condition: 'consumidor_final',
      }));
      return;
    }

    const cust = customers.find((c) => c.id === customerId);
    if (!cust) return;

    let docType: 'DNI' | 'CUIT' | 'CUIL' | 'SinIdentificar' = 'SinIdentificar';
    let docNum = '';
    if (cust.cuit) {
      docType = 'CUIT';
      docNum = cust.cuit.replace(/\D/g, '');
    } else if (cust.document_number) {
      docType = (cust.document_type as 'DNI' | 'CUIT' | 'CUIL') || 'DNI';
      docNum = cust.document_number.replace(/\D/g, '');
    }

    const ivaCond = (cust.iva_condition as 'consumidor_final' | 'responsable_inscripto' | 'monotributista' | 'sujeto_exento') || 'consumidor_final';

    // Determinar factura sugerida según el emisor y la condición del receptor.
    let invType: 'A' | 'B' | 'C';
    if (emisorEsResponsableInscripto) {
      invType = ivaCond === 'responsable_inscripto' ? 'A' : 'B';
    } else {
      invType = 'C';
    }

    setCreateForm((prev) => ({
      ...prev,
      customer_id: cust.id,
      customer_name: cust.name,
      document_type: docType,
      document_number: docNum,
      iva_condition: ivaCond,
      invoice_type: invType,
    }));
  };

  const handleAddItem = () => {
    setCreateForm((prev) => ({
      ...prev,
      items: [...prev.items, { description: '', quantity: 1, unit_price: 0, iva_percentage: 21 }],
    }));
  };

  // Al elegir un producto del listado se completa la descripción y el precio
  // unitario; el usuario puede luego editarlos a mano.
  const handleSelectItemProduct = (index: number, productId: string) => {
    setCreateForm((prev) => {
      const items = prev.items.map((it, i) => {
        if (i !== index) return it;
        if (!productId) return { ...it, product_id: undefined };
        const product = products.find((p) => p.id === productId);
        if (!product) return { ...it, product_id: undefined };
        return {
          ...it,
          product_id: product.id,
          description: product.name,
          unit_price: product.price ?? 0,
        };
      });
      return { ...prev, items };
    });
  };

  const handleRemoveItem = (index: number) => {
    if (createForm.items.length <= 1) return;
    setCreateForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const calculateFormTotal = useMemo(() => {
    return createForm.items.reduce((sum, it) => sum + (it.quantity * it.unit_price), 0);
  }, [createForm.items]);

  // Error de datos mínimos obligatorios del receptor (bloquea la emisión).
  const invoiceValidationError = useMemo(() => {
    if (isCreditNote) {
      return ncOriginalId ? null : 'Elegí el comprobante que acredita la Nota de Crédito';
    }
    return validateFacturaReceptor(createForm, calculateFormTotal);
  }, [isCreditNote, ncOriginalId, createForm, calculateFormTotal]);

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!arcaConfig?.is_active) {
      toast.error('Debes activar la conexión con ARCA en Configuración antes de emitir comprobantes');
      return;
    }

    // Nota de Crédito: se emite contra una factura existente (CbtesAsoc), así que
    // reutilizamos el endpoint de NC en vez de crear un comprobante suelto.
    if (isCreditNote) {
      if (!ncOriginalId) {
        toast.error('Elegí el comprobante que acredita la Nota de Crédito');
        return;
      }

      setCreating(true);
      try {
        const res = await authFetch(`/api/arca/invoices/${ncOriginalId}/credit-note`, {
          method: 'POST',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al emitir Nota de Crédito');

        toast.success(
          `Nota de Crédito ${data.invoice_type} N° ${String(data.invoice_number).padStart(8, '0')} autorizada · CAE ${data.cae}`,
          { duration: 8000 }
        );
        setShowCreateModal(false);
        setNcOriginalId('');
        await fetchData();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Error al emitir Nota de Crédito');
      } finally {
        setCreating(false);
      }
      return;
    }

    // Datos mínimos obligatorios del receptor (CUIT para Factura A, etc.).
    const receptorError = validateFacturaReceptor(createForm, calculateFormTotal);
    if (receptorError) {
      toast.error(receptorError);
      return;
    }

    for (const item of createForm.items) {
      if (!item.product_id && !item.description.trim()) {
        toast.error('Seleccioná un producto en cada ítem');
        return;
      }
      if (item.quantity <= 0 || item.unit_price <= 0) {
        toast.error('La cantidad y precio unitario deben ser mayores a 0');
        return;
      }
    }

    setCreating(true);
    try {
      const payload = {
        customer_id: createForm.customer_id || undefined,
        customer_name: createForm.customer_name.trim(),
        document_type: createForm.document_type,
        document_number: createForm.document_number.trim() || undefined,
        iva_condition: createForm.iva_condition,
        invoice_type: createForm.invoice_type,
        items: createForm.items.map((it) => ({
          product_id: it.product_id,
          description: it.description.trim(),
          quantity: it.quantity,
          unit_price_cents: Math.round(it.unit_price * 100),
          iva_percentage: it.iva_percentage,
        })),
      };

      const res = await authFetch('/api/arca/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al emitir factura');

      toast.success(`¡Factura ${data.invoice_type} N° ${String(data.invoice_number).padStart(8, '0')} autorizada con CAE ${data.cae}!`);
      setShowCreateModal(false);
      await fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al emitir comprobante');
    } finally {
      setCreating(false);
    }
  };

  const handleViewInvoice = async (invoiceId: string) => {
    try {
      const res = await authFetch(`/api/arca/invoices/${invoiceId}`);
      if (!res.ok) throw new Error('Error al cargar detalle');
      const data = await res.json();
      setSelectedInvoice(data);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar comprobante');
    }
  };

  const handleIssueCreditNote = async () => {
    if (!ncTarget) return;
    setIssuingNc(true);
    try {
      const res = await authFetch(`/api/arca/invoices/${ncTarget.id}/credit-note`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al emitir Nota de Crédito');

      toast.success(
        `Nota de Crédito ${data.invoice_type} N° ${String(data.invoice_number).padStart(8, '0')} autorizada · CAE ${data.cae}`,
        { duration: 8000 }
      );
      setNcTarget(null);
      setSelectedInvoice(null);
      await fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error al emitir Nota de Crédito');
    } finally {
      setIssuingNc(false);
    }
  };

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (typeFilter !== 'all' && inv.invoice_type !== typeFilter) return false;
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const term = search.trim();
      return (
        matchesQuery(inv.customer_name, term) ||
        (inv.document_number && matchesQuery(inv.document_number, term)) ||
        matchesQuery(String(inv.invoice_number), term) ||
        (inv.cae && matchesQuery(inv.cae, term))
      );
    });
  }, [invoices, typeFilter, statusFilter, search]);

  const INVOICES_PER_PAGE = 15;
  const {
    currentPage: invoicesPage,
    setCurrentPage: setInvoicesPage,
    totalPages: invoiceTotalPages,
    pageItems: paginatedInvoices,
  } = usePagination(filteredInvoices, INVOICES_PER_PAGE);

  // Al cambiar de filtro o de búsqueda se vuelve a la primera página, para no
  // quedar parado en una página que ya no corresponde al resultado filtrado.
  useEffect(() => {
    setInvoicesPage(1);
  }, [typeFilter, statusFilter, search, setInvoicesPage]);

  // Total facturado neto del período: las facturas suman y las Notas de Crédito
  // restan (acreditan ventas ya facturadas). Los comprobantes de prueba (Modo
  // Sandbox) no tienen validez fiscal, así que no se contabilizan.
  const totalFacturadoMes = useMemo(() => {
    return invoices
      .filter((inv) => inv.status === 'approved' && !inv.is_sandbox)
      .reduce((sum, inv) => sum + (inv.invoice_type.startsWith('NC_') ? -inv.total_cents : inv.total_cents), 0);
  }, [invoices]);

  const countApproved = useMemo(() => {
    return invoices.filter((inv) => inv.status === 'approved' && !inv.is_sandbox).length;
  }, [invoices]);

  if (authLoading || !canInvoice) return null;

  if (country !== 'AR') {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Facturación no disponible</h1>
        <p className="text-sm text-gray-600 text-center max-w-md mb-4">
          El módulo de facturación solo está disponible para cuentas de Argentina. ARCA (ex-AFIP) solo opera en Argentina.
        </p>
        <Button onClick={() => router.replace('/dashboard')}>Volver al inicio</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<FileText className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />}
        title="Facturación Electrónica"
        subtitle="Emisión y control de Facturas A, B y C con CAE autorizadas ante ARCA (ex-AFIP)."
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                setNcOriginalId('');
                setShowCreateModal(true);
              }}
              disabled={!arcaConfig?.is_active}
              className="flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Nueva Factura
            </Button>
          </div>
        }
      />

      {/* Banner de Estado de ARCA */}
      {!arcaConfig?.is_active && (
        <Card className="p-4 border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  ARCA no está conectado o falta probar la conexión
                </h4>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  Para emitir comprobantes fiscales electrónicos válidos, cargá tu certificado y clave privada en Ajustes.
                </p>
              </div>
            </div>
            <Link href="/settings?tab=facturacion">
              <Button size="sm" variant="outline" className="border-amber-300 dark:border-amber-700 text-xs flex items-center gap-1">
                <Settings className="h-3.5 w-3.5" />
                Configurar ARCA
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {/* Modo Sandbox activo (aviso compacto) */}
      {arcaConfig?.is_sandbox && (
        <div className="flex items-start gap-2 rounded-lg border border-purple-200 dark:border-purple-900/40 bg-purple-50/60 dark:bg-purple-950/20 px-3 py-2 text-xs text-purple-800 dark:text-purple-300">
          <FlaskConical className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <strong>Modo Sandbox activo.</strong> Podés emitir Facturas A, B y C al instante con CAE y código QR
            simulados, sin trámites. No tienen validez fiscal: quedan marcadas como <em>Prueba</em> en el listado y
            no se incluyen en los totales.
          </span>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Facturado</span>
            <DollarSign className="h-5 w-5 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2">
            {formatARS(totalFacturadoMes / 100)}
          </div>
          <p className="text-xs text-gray-400 mt-1">Comprobantes aprobados</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Comprobantes Emitidos</span>
            <FileText className="h-5 w-5 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2">
            {countApproved}
          </div>
          <p className="text-xs text-gray-400 mt-1">Con CAE oficial</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Estado de Conexión</span>
            <Building2 className="h-5 w-5 text-blue-500" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            {arcaConfig?.is_active ? (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                Activo ({arcaConfig.environment === 'produccion' ? 'Producción' : 'Homologación'})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                Desconectado
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Punto de Venta: {String(arcaConfig?.punto_venta || 1).padStart(4, '0')}
          </p>
        </Card>
      </div>

      {/* Filtros y Búsqueda */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, CUIT/DNI, número de comprobante o CAE..."
            />
          </div>
          <div className="w-full sm:w-48">
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">Todos los tipos</option>
              <option value="A">Factura A</option>
              <option value="B">Factura B</option>
              <option value="C">Factura C</option>
              <option value="NC_A">Nota de Crédito A</option>
              <option value="NC_B">Nota de Crédito B</option>
              <option value="NC_C">Nota de Crédito C</option>
            </Select>
          </div>
          <div className="w-full sm:w-44">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Todos los estados</option>
              <option value="approved">Aprobadas</option>
              <option value="cancelled">Anuladas</option>
              <option value="pending">Pendientes</option>
              <option value="rejected">Rechazadas</option>
            </Select>
          </div>
        </div>
      </Card>

      {/* Tabla de Facturas */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          </div>
        ) : filteredInvoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No se encontraron comprobantes"
            description={
              search
                ? 'No hay facturas que coincidan con los filtros aplicados.'
                : 'Aún no has emitido facturas electrónicas a través de ARCA.'
            }
          />
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <Thead>
                <Th>Comprobante</Th>
                <Th>Fecha</Th>
                <Th>Cliente / Receptor</Th>
                <Th>CAE / Vto.</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-center">Estado</Th>
                <Th className="text-right">Acciones</Th>
              </Thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {paginatedInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-900/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                          {inv.invoice_type}
                        </span>
                        <span>
                          {String(inv.punto_venta).padStart(4, '0')}-{String(inv.invoice_number).padStart(8, '0')}
                        </span>
                        {inv.is_sandbox && (
                          <Tooltip
                            align="start"
                            content="Comprobante de prueba emitido en Modo Sandbox: el CAE y el código QR son simulados y no tiene validez fiscal. No se incluye en los totales."
                          >
                            <button
                              type="button"
                              className="inline-block cursor-help rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-purple-800 outline-none focus:ring-2 focus:ring-purple-400 dark:bg-purple-950 dark:text-purple-300"
                            >
                              Prueba
                            </button>
                          </Tooltip>
                        )}
                      </div>
                      {inv.related_invoice_id && (
                        <div className="mt-0.5 text-[11px] text-gray-400">
                          Acredita comprobante anterior
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(inv.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900 dark:text-gray-100 font-medium">
                        {inv.customer_name}
                      </div>
                      {inv.document_number && (
                        <div className="text-xs text-gray-400">
                          {inv.document_type}: {inv.document_number}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {inv.cae ? (
                        <div>
                          <span className="font-mono font-medium text-gray-800 dark:text-gray-200">{inv.cae}</span>
                          {inv.cae_due_date && (
                            <span className="block text-[11px] text-gray-400">
                              Vto: {inv.cae_due_date.slice(6, 8)}/{inv.cae_due_date.slice(4, 6)}/{inv.cae_due_date.slice(0, 4)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100">
                      {formatARS(inv.total_cents / 100)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {inv.status === 'approved' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" /> Aprobada
                        </span>
                      ) : inv.status === 'cancelled' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                          <Ban className="h-3 w-3" /> Anulada
                        </span>
                      ) : inv.status === 'pending' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3" /> Pendiente
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
                          <XCircle className="h-3 w-3" /> Rechazada
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleViewInvoice(inv.id)}
                          className="h-8 px-2.5 text-xs flex items-center gap-1"
                        >
                          <QrCode className="h-3.5 w-3.5 text-indigo-500" />
                          Ver / QR
                        </Button>
                        {inv.status === 'approved' && !inv.invoice_type.startsWith('NC_') && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setNcTarget(inv)}
                            className="h-8 px-2.5 text-xs flex items-center gap-1 text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/30"
                          >
                            <Receipt className="h-3.5 w-3.5" />
                            Nota de Crédito
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={invoicesPage}
            totalPages={invoiceTotalPages}
            onPageChange={setInvoicesPage}
            resultInfo={`Mostrando ${(invoicesPage - 1) * INVOICES_PER_PAGE + 1}–${Math.min(invoicesPage * INVOICES_PER_PAGE, filteredInvoices.length)} de ${filteredInvoices.length} comprobantes`}
          />
          </>
        )}
      </Card>

      {/* Modal Nueva Factura Electrónica */}
      {showCreateModal && (
        <Modal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="Emitir Comprobante Electrónico ARCA"
          className="max-w-3xl"
        >
          <form onSubmit={handleCreateInvoice} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FormLabel>Tipo de Comprobante</FormLabel>
                <Select
                  value={createForm.invoice_type}
                  onChange={(e) => {
                    const value = e.target.value as VoucherType;
                    setCreateForm((prev) => ({ ...prev, invoice_type: value }));
                    setNcOriginalId('');
                  }}
                >
                  {voucherOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </div>

              {isCreditNote ? (
                <div>
                  <FormLabel>Comprobante que acredita</FormLabel>
                  <Select value={ncOriginalId} onChange={(e) => setNcOriginalId(e.target.value)}>
                    <option value="">Seleccionar comprobante...</option>
                    {creditNoteCandidates.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_type} {String(inv.punto_venta).padStart(4, '0')}-
                        {String(inv.invoice_number).padStart(8, '0')} · {inv.customer_name} ·{' '}
                        {formatARS(inv.total_cents / 100)}
                      </option>
                    ))}
                  </Select>
                  {creditNoteCandidates.length === 0 && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      No hay Facturas {ncSeriesLetter} aprobadas para acreditar.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <FormLabel>Cliente Registrado (Opcional)</FormLabel>
                    <Select
                      value={createForm.customer_id}
                      onChange={(e) => handleSelectCustomer(e.target.value)}
                    >
                      <option value="">Consumidor Final (Sin registrar)</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} {c.cuit ? `(CUIT ${c.cuit})` : ''}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <FormLabel>Razón Social o Nombre del Cliente</FormLabel>
                    <Input
                      type="text"
                      required
                      placeholder="Nombre o Razón Social"
                      value={createForm.customer_name}
                      onChange={(e) => setCreateForm({ ...createForm, customer_name: e.target.value })}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <FormLabel>Tipo Doc</FormLabel>
                      <Select
                        value={createForm.document_type}
                        onChange={(e) => setCreateForm({ ...createForm, document_type: e.target.value as 'DNI' | 'CUIT' | 'CUIL' | 'SinIdentificar' })}
                      >
                        <option value="SinIdentificar">Sin Doc</option>
                        <option value="DNI">DNI</option>
                        <option value="CUIT">CUIT</option>
                        <option value="CUIL">CUIL</option>
                      </Select>
                    </div>
                    <div>
                      <FormLabel>Número Doc</FormLabel>
                      <Input
                        type="text"
                        placeholder="XX-XXXXXXXX-X"
                        value={createForm.document_number}
                        onChange={(e) => setCreateForm({ ...createForm, document_number: e.target.value })}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {isCreditNote ? (
              ncOriginal && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 p-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
                  <p>
                    Se emitirá una <strong>Nota de Crédito {ncSeriesLetter}</strong> por{' '}
                    <strong>{formatARS(ncOriginal.total_cents / 100)}</strong> a {ncOriginal.customer_name}.
                  </p>
                  <p className="text-gray-400 dark:text-gray-500">
                    La factura original quedará anulada. La acción no se puede deshacer.
                  </p>
                </div>
              )
            ) : (
              <>
            {/* Ítems */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-2">
                <FormLabel className="mb-0">Ítems de la Factura</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddItem}
                  className="h-7 text-xs flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> Agregar ítem
                </Button>
              </div>

              <div className="space-y-2">
                {createForm.items.map((item, index) => (
                  <div key={index} className="space-y-1 bg-gray-50/50 dark:bg-gray-900/30 p-2 rounded-lg">
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-12 sm:col-span-6">
                        <Select
                          value={item.product_id || ''}
                          onChange={(e) => handleSelectItemProduct(index, e.target.value)}
                          aria-label="Producto"
                          searchable={products.length > 8}
                          className="w-full"
                        >
                          <option value="">Producto / servicio (opcional)</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.sku ? ` · ${p.sku}` : ''}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="col-span-5 sm:col-span-2">
                        <Input
                          type="number"
                          min={1}
                          aria-label="Cantidad"
                          title="Cantidad"
                          value={item.quantity}
                          onChange={(e) => {
                            const updated = [...createForm.items];
                            updated[index].quantity = parseInt(e.target.value, 10) || 1;
                            setCreateForm({ ...createForm, items: updated });
                          }}
                        />
                      </div>
                      <div className="col-span-5 sm:col-span-3">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="Precio ($)"
                          value={item.unit_price || ''}
                          onChange={(e) => {
                            const updated = [...createForm.items];
                            updated[index].unit_price = parseFloat(e.target.value) || 0;
                            setCreateForm({ ...createForm, items: updated });
                          }}
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(index)}
                          disabled={createForm.items.length <= 1}
                          aria-label="Eliminar ítem"
                          className="p-1.5 text-gray-400 hover:text-red-500 disabled:opacity-30 transition-colors shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Total */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm">
              <span className="font-semibold text-gray-700 dark:text-gray-300">Total a Facturar:</span>
              <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{formatARS(calculateFormTotal)}</span>
            </div>
              </>
            )}

            {invoiceValidationError && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 p-3 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{invoiceValidationError}</span>
              </div>
            )}

            {/* Botones de acción */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={creating || !!invoiceValidationError}
                className="flex items-center gap-1.5"
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                    {isCreditNote ? 'Emitiendo Nota de Crédito...' : 'Solicitando CAE a ARCA...'}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    {isCreditNote ? 'Emitir Nota de Crédito' : 'Emitir Factura con ARCA'}
                  </>
                )}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal Ver Comprobante / Imprimir */}
      {selectedInvoice && (
        <Modal
          open={Boolean(selectedInvoice)}
          onClose={() => setSelectedInvoice(null)}
          title={`Comprobante Fiscal: ${voucherDisplayName(selectedInvoice.invoice_type)} N° ${String(selectedInvoice.punto_venta).padStart(4, '0')}-${String(selectedInvoice.invoice_number).padStart(8, '0')}`}
          className="max-w-3xl"
        >
          <div className="space-y-4">
            {/* Selector de formato de impresión + acciones */}
            <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
              <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
                {([['a4', 'A4'], ['58mm', 'Ticket 58mm'], ['80mm', 'Ticket 80mm']] as const).map(([size, label]) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setPaperSize(size)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                      paperSize === size
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {selectedInvoice.status === 'approved' && !selectedInvoice.invoice_type.startsWith('NC_') && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setNcTarget(selectedInvoice)}
                    className="flex items-center gap-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/30"
                  >
                    <Receipt className="h-4 w-4" /> Emitir Nota de Crédito
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <Printer className="h-4 w-4" /> Imprimir
                </Button>
              </div>
            </div>

            {selectedInvoice.related_invoice_id && (
              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5 print:hidden">
                <Receipt className="h-3.5 w-3.5" />
                Esta Nota de Crédito acredita un comprobante anterior.
              </p>
            )}

            {selectedInvoice.status === 'cancelled' && (
              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5 print:hidden">
                <Ban className="h-3.5 w-3.5" />
                Comprobante anulado (acreditado por una Nota de Crédito).
              </p>
            )}

            {selectedInvoice.is_sandbox && (
              <div className="rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40 p-3 text-xs text-purple-800 dark:text-purple-300 flex items-start gap-1.5 print:hidden">
                <FlaskConical className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Comprobante emitido en <strong>Modo Sandbox</strong>: el CAE y el código QR son simulados y{' '}
                  <strong>no tienen validez fiscal</strong>.
                </span>
              </div>
            )}

            {/* Documento */}
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden shadow-sm flex justify-center bg-gray-100 dark:bg-gray-950">
              <div
                className="bg-white text-left"
                style={{ width: paperSize === 'a4' ? '100%' : paperSize }}
              >
                <InvoiceDocument invoice={selectedInvoice} tenant={tenantForInvoice} paperSize={paperSize} />
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirmación de Nota de Crédito */}
      {ncTarget && (
        <Modal
          open={Boolean(ncTarget)}
          onClose={() => {
            if (!issuingNc) setNcTarget(null);
          }}
          title="Emitir Nota de Crédito"
          className="max-w-md"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Vas a emitir una Nota de Crédito que acredita el comprobante{' '}
              <strong>
                {ncTarget.invoice_type} {String(ncTarget.punto_venta).padStart(4, '0')}-
                {String(ncTarget.invoice_number).padStart(8, '0')}
              </strong>{' '}
              por <strong>{formatARS(ncTarget.total_cents / 100)}</strong> a {ncTarget.customer_name}.
            </p>
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Se solicita el CAE a ARCA y la factura original queda anulada. Esta acción no se puede deshacer.</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setNcTarget(null)} disabled={issuingNc}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleIssueCreditNote}
                disabled={issuingNc}
                className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white"
              >
                {issuingNc ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Solicitando CAE...
                  </>
                ) : (
                  <>
                    <Receipt className="h-4 w-4" /> Emitir Nota de Crédito
                  </>
                )}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Área oculta usada sólo al imprimir */}
      {selectedInvoice && (
        <PrintInvoice invoice={selectedInvoice} tenant={tenantForInvoice} paperSize={paperSize} />
      )}
    </div>
  );
}
