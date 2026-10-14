'use client';

import { QrCode } from 'lucide-react';
import { formatARS } from '@/lib/utils/currency';
import { cn } from '@/lib/utils/cn';
import {
  VOUCHER_TYPE_CODES,
  VOUCHER_TYPE_NAMES,
  type ElectronicInvoiceRecord,
} from '@/lib/types/arca';

export type InvoicePaperSize = 'a4' | '58mm' | '80mm';

export interface InvoiceTenant {
  name?: string | null;
  company_name?: string | null;
  razon_social?: string | null;
  cuit?: string | null;
  iva_condition?: string | null;
  ingresos_brutos?: string | null;
  inicio_actividades?: string | null;
  business_address?: string | null;
  business_city?: string | null;
  business_province?: string | null;
  business_zip?: string | null;
  business_phone?: string | null;
  business_email?: string | null;
}

export type InvoiceDocumentData = ElectronicInvoiceRecord & {
  qr_data_url?: string;
  qr_url?: string;
};

/** Letra de la serie del comprobante (A/B/C) a partir del tipo almacenado. */
export function voucherLetter(invoiceType: string): string {
  if (invoiceType.startsWith('NC_') || invoiceType.startsWith('ND_')) return invoiceType.slice(3);
  return invoiceType;
}

/** Código numérico ARCA del comprobante (se usa en el recuadro de la letra). */
export function voucherCode(invoiceType: string): number | undefined {
  return VOUCHER_TYPE_CODES[invoiceType];
}

export function voucherDisplayName(invoiceType: string): string {
  const code = VOUCHER_TYPE_CODES[invoiceType];
  return code ? VOUCHER_TYPE_NAMES[code] : `Factura ${invoiceType}`;
}

const IVA_CONDITION_LABELS: Record<string, string> = {
  responsable_inscripto: 'IVA Responsable Inscripto',
  monotributista: 'Responsable Monotributo',
  consumidor_final: 'Consumidor Final',
  sujeto_exento: 'Sujeto Exento',
  responsable_no_inscripto: 'Responsable No Inscripto',
};

export function ivaConditionLabel(condition?: string | null): string {
  if (!condition) return 'Consumidor Final';
  return IVA_CONDITION_LABELS[condition] ?? condition.replace(/_/g, ' ');
}

/** La fecha del comprobante viene como ISO; se muestra en horario local. */
export function formatInvoiceDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** cae_due_date se guarda como YYYYMMDD. */
export function formatCaeDueDate(compact?: string | null): string {
  if (!compact || compact.length < 8) return '—';
  return `${compact.slice(6, 8)}/${compact.slice(4, 6)}/${compact.slice(0, 4)}`;
}

function InvoiceQr({
  invoice,
  className,
  imgClassName,
}: {
  invoice: InvoiceDocumentData;
  className?: string;
  imgClassName?: string;
}) {
  const src = invoice.qr_data_url || invoice.qr_url;
  if (!src) {
    return (
      <div className={cn('flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded', className)}>
        <QrCode className="h-10 w-10 text-gray-400" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Código QR Oficial ARCA"
      className={cn('border border-gray-200 dark:border-gray-700 rounded p-1 bg-white', className, imgClassName)}
    />
  );
}

function A4Document({ invoice, tenant }: { invoice: InvoiceDocumentData; tenant: InvoiceTenant }) {
  const letter = voucherLetter(invoice.invoice_type);
  const code = voucherCode(invoice.invoice_type);
  const name = voucherDisplayName(invoice.invoice_type);
  const isNC = invoice.invoice_type.startsWith('NC_');
  const showIva = letter !== 'C';

  return (
    <div className="invoice-doc bg-white text-gray-900 text-xs p-4">
      {invoice.is_sandbox && (
        <div className="mb-3 border-2 border-dashed border-red-500 text-red-600 text-center font-bold uppercase tracking-widest text-[11px] py-1 rounded">
          Documento de prueba — sin validez fiscal
        </div>
      )}
      <div className="grid grid-cols-12 gap-3 border-b-2 border-gray-800 pb-3">
        <div className="col-span-6">
          <h1 className="text-lg font-bold leading-tight">{tenant.company_name || tenant.razon_social || tenant.name || 'Mi Comercio'}</h1>
          {tenant.razon_social && tenant.company_name && (
            <p className="text-[11px] text-gray-600">{tenant.razon_social}</p>
          )}
          <p className="mt-1">{tenant.business_address || ''}</p>
          {(tenant.business_city || tenant.business_province) && (
            <p>{[tenant.business_city, tenant.business_province, tenant.business_zip].filter(Boolean).join(' · ')}</p>
          )}
          {tenant.business_phone && <p>Tel: {tenant.business_phone}</p>}
          <p className="mt-1"><strong>Condición IVA:</strong> {ivaConditionLabel(tenant.iva_condition)}</p>
        </div>

        <div className="col-span-3 text-center flex flex-col items-center justify-center">
          <div className="inline-flex flex-col items-center">
            <div className="w-14 h-14 border-2 border-gray-900 flex items-center justify-center text-2xl font-bold">
              {letter}
            </div>
            <span className="text-[10px] text-gray-500 mt-1">
              COD. {String(code ?? '').padStart(2, '0')}
            </span>
          </div>
        </div>

        <div className="col-span-3 text-right">
          <h2 className="text-sm font-bold uppercase">{name}</h2>
          <p className="font-mono mt-1">
            N° {String(invoice.punto_venta).padStart(4, '0')}-{String(invoice.invoice_number).padStart(8, '0')}
          </p>
          <p className="mt-1">Fecha: {formatInvoiceDate(invoice.created_at)}</p>
          <p className="mt-1 text-[11px]">CUIT: {invoice.cuit_emisor}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-b border-gray-300 py-3">
        <div>
          <p className="text-[10px] uppercase text-gray-500">Receptor</p>
          <p className="font-medium text-sm">{invoice.customer_name}</p>
          <p>{invoice.document_type}: {invoice.document_number || '—'}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-gray-500">Condición frente al IVA</p>
          <p className="font-medium">{ivaConditionLabel(invoice.iva_condition)}</p>
          {tenant.ingresos_brutos && <p>Ingresos Brutos: {tenant.ingresos_brutos}</p>}
          {tenant.inicio_actividades && <p>Inicio de actividades: {tenant.inicio_actividades}</p>}
        </div>
      </div>

      <table className="w-full text-left mt-3">
        <thead>
          <tr className="border-b border-gray-300 text-[10px] uppercase text-gray-500">
            <th className="py-1">Descripción</th>
            <th className="py-1 text-center">Cant.</th>
            <th className="py-1 text-right">P. Unit.</th>
            <th className="py-1 text-right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items && invoice.items.length > 0 ? (
            invoice.items.map((it) => (
              <tr key={it.id} className="border-b border-gray-100">
                <td className="py-1.5">{it.description}</td>
                <td className="py-1.5 text-center">{it.quantity}</td>
                <td className="py-1.5 text-right">{formatARS(it.unit_price_cents / 100)}</td>
                <td className="py-1.5 text-right">{formatARS(it.subtotal_cents / 100)}</td>
              </tr>
            ))
          ) : (
            <tr className="border-b border-gray-100">
              <td className="py-1.5">{name}</td>
              <td className="py-1.5 text-center">1</td>
              <td className="py-1.5 text-right">{formatARS(invoice.total_cents / 100)}</td>
              <td className="py-1.5 text-right">{formatARS(invoice.total_cents / 100)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-3 flex flex-col items-end gap-0.5">
        {showIva && (
          <>
            <div className="flex justify-between w-56">
              <span>Importe Neto:</span>
              <span>{formatARS(invoice.net_cents / 100)}</span>
            </div>
            <div className="flex justify-between w-56">
              <span>IVA ({invoice.iva_percentage}%):</span>
              <span>{formatARS(invoice.iva_cents / 100)}</span>
            </div>
          </>
        )}
        <div className="flex justify-between w-56 text-sm font-bold border-t border-gray-300 pt-1">
          <span>TOTAL:</span>
          <span>{formatARS(invoice.total_cents / 100)}</span>
        </div>
      </div>

      {isNC && invoice.related_invoice_id && (
        <p className="mt-2 text-[10px] text-gray-500">
          Nota de Crédito que acredita al comprobante original (ver CbtesAsoc).
        </p>
      )}

      <div className="border-t-2 border-dashed border-gray-400 mt-4 pt-3 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <InvoiceQr invoice={invoice} className="w-24 h-24" />
          <div className="space-y-1">
            <p className="text-[11px] font-bold">
              {invoice.is_sandbox ? 'Comprobante de Prueba (Modo Sandbox)' : 'Comprobante Autorizado por ARCA'}
            </p>
            <p><strong>CAE N°:</strong> <span className="font-mono">{invoice.cae || '—'}</span></p>
            <p><strong>Fecha Vto. CAE:</strong> {formatCaeDueDate(invoice.cae_due_date)}</p>
          </div>
        </div>
        <p className="text-[10px] text-gray-400 text-right max-w-[180px]">
          {invoice.is_sandbox
            ? 'Documento sin validez fiscal. Emitido en Modo Sandbox con CAE simulado.'
            : 'Documento generado electrónicamente. Validez fiscal acreditada por el CAE.'}
        </p>
      </div>
    </div>
  );
}

function TicketDocument({ invoice, tenant }: { invoice: InvoiceDocumentData; tenant: InvoiceTenant }) {
  const letter = voucherLetter(invoice.invoice_type);
  const name = voucherDisplayName(invoice.invoice_type);
  const showIva = letter !== 'C';

  return (
    <div className="invoice-doc bg-white text-gray-900 font-mono text-[11px] leading-relaxed px-2 py-1">
      {invoice.is_sandbox && (
        <p className="text-center font-bold text-red-600 border-y-2 border-dashed border-red-500 py-1 my-1">
          *** DOCUMENTO DE PRUEBA ***
          <br />
          SIN VALIDEZ FISCAL
        </p>
      )}
      <p className="text-center font-bold text-[12px]">
        {tenant.company_name || tenant.razon_social || tenant.name || 'Mi Comercio'}
      </p>
      {tenant.business_address && <p className="text-center">{tenant.business_address}</p>}
      {tenant.business_phone && <p className="text-center">Tel: {tenant.business_phone}</p>}
      <p className="text-center">CUIT: {invoice.cuit_emisor}</p>
      <p className="text-center">{ivaConditionLabel(tenant.iva_condition)}</p>
      <p className="text-center">{tenant.inicio_actividades ? `Inicio act.: ${tenant.inicio_actividades}` : ''}</p>
      <p className="border-t border-dashed border-gray-400 my-1" />

      <p className="text-center font-bold">{name.toUpperCase()}</p>
      <p className="text-center">
        N° {String(invoice.punto_venta).padStart(4, '0')}-{String(invoice.invoice_number).padStart(8, '0')}
      </p>
      <p className="text-center">{formatInvoiceDate(invoice.created_at)}</p>
      <p className="border-t border-dashed border-gray-400 my-1" />

      <p>{invoice.customer_name}</p>
      <p>
        {invoice.document_type}: {invoice.document_number || '—'}
      </p>
      <p>{ivaConditionLabel(invoice.iva_condition)}</p>
      <p className="border-t border-dashed border-gray-400 my-1" />

      {(invoice.items ?? []).map((it) => (
        <div key={it.id}>
          <p>
            {it.quantity} x {it.description}
          </p>
          <p className="flex justify-between">
            <span className="pl-2">{formatARS(it.unit_price_cents / 100)} c/u</span>
            <span>{formatARS(it.subtotal_cents / 100)}</span>
          </p>
        </div>
      ))}
      <p className="border-t border-dashed border-gray-400 my-1" />

      {showIva && (
        <>
          <p className="flex justify-between">
            <span>Neto</span>
            <span>{formatARS(invoice.net_cents / 100)}</span>
          </p>
          <p className="flex justify-between">
            <span>IVA {invoice.iva_percentage}%</span>
            <span>{formatARS(invoice.iva_cents / 100)}</span>
          </p>
        </>
      )}
      <p className="flex justify-between font-bold text-[13px]">
        <span>TOTAL</span>
        <span>{formatARS(invoice.total_cents / 100)}</span>
      </p>
      <p className="border-t border-dashed border-gray-400 my-1" />

      <p className="text-center">CAE N°: {invoice.cae || '—'}</p>
      <p className="text-center">Vto. CAE: {formatCaeDueDate(invoice.cae_due_date)}</p>
      <div className="flex justify-center mt-1">
        <InvoiceQr invoice={invoice} className="w-20 h-20" />
      </div>
      <p className="text-center mt-1">
        {invoice.is_sandbox ? 'Comprobante de prueba (Modo Sandbox)' : 'Comprobante autorizado por ARCA'}
      </p>
    </div>
  );
}

export function InvoiceDocument({
  invoice,
  tenant,
  paperSize,
}: {
  invoice: InvoiceDocumentData;
  tenant: InvoiceTenant;
  paperSize: InvoicePaperSize;
}) {
  if (paperSize === 'a4') {
    return <A4Document invoice={invoice} tenant={tenant} />;
  }
  return <TicketDocument invoice={invoice} tenant={tenant} />;
}

export function InvoicePrintStyles({ paperSize }: { paperSize: InvoicePaperSize }) {
  return (
    <style>{`
      @media print {
        body * { visibility: hidden !important; }
        #invoice-print-area, #invoice-print-area * { visibility: visible !important; }
        #invoice-print-area {
          position: absolute !important;
          left: 0 !important;
          top: 0 !important;
          margin: 0 !important;
          border: none !important;
          box-shadow: none !important;
        }
        .invoice-doc { padding: 0 !important; }
      }
      ${paperSize === 'a4' ? '@page { size: A4 portrait; margin: 10mm; }' : '@page { margin: 3mm; }'}
    `}</style>
  );
}

export function PrintInvoice({
  invoice,
  tenant,
  paperSize,
}: {
  invoice: InvoiceDocumentData;
  tenant: InvoiceTenant;
  paperSize: InvoicePaperSize;
}) {
  return (
    <>
      <InvoicePrintStyles paperSize={paperSize} />
      <div className="hidden print:block" aria-hidden="true">
        <div
          id="invoice-print-area"
          className="bg-white text-gray-900"
          style={{ width: paperSize === 'a4' ? '100%' : paperSize }}
        >
          <InvoiceDocument invoice={invoice} tenant={tenant} paperSize={paperSize} />
        </div>
      </div>
    </>
  );
}
