'use client';

import React from 'react';
import {
  Printer,
  MessageCircle,
  X,
  Ruler,
} from 'lucide-react';
import { IconAction } from '@/components/ui/icon-action';
import {
  getPaymentMethodLabel,
} from '@/lib/payment-methods';
import { formatARS } from '@/lib/utils/currency';
import { cn } from '@/lib/utils/cn';
import {
  buildWhatsAppUrl,
  formatReceiptDate,
  type ReceiptSale,
  type ReceiptTenant,
} from '@/lib/sales-receipt';

// Se re-exportan para no romper imports existentes: la implementación vive en
// `@/lib/sales-receipt` (sin React) y así otras pantallas pueden compartir el
// ticket sin cargar este componente.
export { buildWhatsAppUrl, buildWhatsAppText } from '@/lib/sales-receipt';
export type { ReceiptSale, ReceiptTenant } from '@/lib/sales-receipt';

interface ReceiptModalProps {
  sale: ReceiptSale;
  tenant: ReceiptTenant;
  paperSize: '58mm' | '80mm';
  onPaperSizeChange: (size: '58mm' | '80mm') => void;
  onClose: () => void;
}

export function PrintStyles() {
  return (
    <style>{`
      @media print {
        body * { visibility: hidden !important; }
        #receipt-print-area, #receipt-print-area * { visibility: visible !important; }
        #receipt-print-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; box-shadow: none !important; margin: 0 !important; border: none !important; }
      }
      @page { margin: 4mm; }
    `}</style>
  );
}

function ReceiptBody({ sale, tenant }: { sale: ReceiptSale; tenant: ReceiptTenant }) {
  const businessName = tenant.company_name || tenant.name || '';
  const hasAdjustments = Object.values(sale.adjustments_applied ?? {}).some((v) => v !== 0);

  return (
    <div className="px-3">
      <p className="text-center font-bold text-[12px]">{businessName}</p>
      {tenant.business_address && (
        <p className="text-center">{tenant.business_address}</p>
      )}
      {tenant.business_phone && (
        <p className="text-center">Tel: {tenant.business_phone}</p>
      )}
      <p className="text-center mt-1">Venta N° {sale.id.slice(0, 8).toUpperCase()}</p>      <p className="text-center">{formatReceiptDate(sale.created_at)}</p>
      <p className="text-center border-t border-dashed border-gray-400 my-1"></p>

      {(sale.items ?? []).map((item, idx) => (
        <div key={`${item.product_name}-${idx}`}>
          <p>
            {item.quantity} x {item.product_name}
          </p>
          <p className="flex justify-between">
            <span className="pl-3">
              {formatARS(item.unit_price_cents / 100)} c/u
            </span>
            <span>{formatARS(item.subtotal_cents / 100)}</span>
          </p>
        </div>
      ))}

      <p className="border-t border-dashed border-gray-400 my-1"></p>

      {sale.discount_cents > 0 && (
        <p className="flex justify-between">
          <span>Descuento</span>
          <span>-{formatARS(sale.discount_cents / 100)}</span>
        </p>
      )}
      {sale.surcharge_cents > 0 && (
        <p className="flex justify-between">
          <span>Recargo</span>
          <span>+{formatARS(sale.surcharge_cents / 100)}</span>
        </p>
      )}
      {hasAdjustments && (
        <p className="text-[10px] text-gray-600">Incluye ajustes automáticos por medio de pago.</p>
      )}
      <p className="flex justify-between font-bold text-[13px]">
        <span>TOTAL</span>
        <span>{formatARS(sale.total_cents / 100)}</span>
      </p>

      <p className="border-t border-dashed border-gray-400 my-1"></p>

      {(sale.payments && sale.payments.length > 0 ? sale.payments : [
        {
          method: sale.payment_method ?? 'cash',
          amount_cents: sale.total_cents,
          received_cents: sale.amount_paid_cents,
          change_cents: sale.change_cents,
        },
      ]).map((p, idx) => (
        <div key={idx}>
          <p className="flex justify-between">
            <span>{getPaymentMethodLabel(p.method)}</span>
            <span>{formatARS(p.amount_cents / 100)}</span>
          </p>
          {p.change_cents > 0 && (
            <p className="flex justify-between">
              <span className="pl-3">Vuelto</span>
              <span>-{formatARS(p.change_cents / 100)}</span>
            </p>
          )}
        </div>
      ))}

      {sale.notes && <p className="mt-1">Nota: {sale.notes}</p>}

      <p className="text-center border-t border-dashed border-gray-400 my-1"></p>
      <p className="text-center">¡Gracias por tu compra!</p>
    </div>
  );
}

export function PrintReceipt({
  sale,
  tenant,
  paperSize,
}: {
  sale: ReceiptSale;
  tenant: ReceiptTenant;
  paperSize: '58mm' | '80mm';
}) {
  return (
    <>
      <PrintStyles />
      <div className="hidden print:block" aria-hidden="true">
        <div
          id="receipt-print-area"
          className="bg-white text-gray-900 font-mono text-[11px] leading-relaxed"
          style={{ width: paperSize === '58mm' ? '58mm' : '80mm' }}
        >
          <ReceiptBody sale={sale} tenant={tenant} />
        </div>
      </div>
    </>
  );
}

export function ReceiptModal({
  sale,
  tenant,
  paperSize,
  onPaperSizeChange,
  onClose,
}: ReceiptModalProps) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 print:hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <PrintStyles />

      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-bold text-gray-900 dark:text-gray-100 text-base flex items-center gap-2">
            <Printer className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            Comprobante
          </h3>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-md border border-gray-200 dark:border-gray-700 p-0.5" title="Tamaño de papel">
              <Ruler className="ml-1.5 h-3.5 w-3.5 text-gray-400" />
              <button
                type="button"
                onClick={() => onPaperSizeChange('58mm')}
                aria-pressed={paperSize === '58mm'}
                className={cn(
                  'px-2 py-1 rounded text-xs font-semibold transition-colors',
                  paperSize === '58mm'
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                )}
              >
                58mm
              </button>
              <button
                type="button"
                onClick={() => onPaperSizeChange('80mm')}
                aria-pressed={paperSize === '80mm'}
                className={cn(
                  'px-2 py-1 rounded text-xs font-semibold transition-colors',
                  paperSize === '80mm'
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                )}
              >
                80mm
              </button>
            </div>
            <IconAction
              icon={X}
              label="Cerrar comprobante"
              tone="muted"
              size="md"
              onClick={onClose}
            />
          </div>
        </div>

        <div className="flex justify-center bg-gray-100 dark:bg-gray-950/60 border-b border-gray-200 dark:border-gray-800">
          <div
            id="receipt-print-area"
            className="bg-white text-gray-900 font-mono text-[11px] leading-relaxed shadow-md my-4 py-3"
            style={{ width: paperSize === '58mm' ? '58mm' : '80mm' }}
          >
            <ReceiptBody sale={sale} tenant={tenant} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 p-4 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-10 rounded-md text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 h-10 inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
          >
            <Printer className="h-4 w-4" />
            Imprimir ticket
          </button>
          <button
            type="button"
            onClick={() =>
              window.open(buildWhatsAppUrl(sale, tenant), '_blank', 'noopener,noreferrer')
            }
            className="h-10 inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors px-4"
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}