'use client';

import { getPaymentMethodLabel } from '@/lib/payment-methods';
import { formatARS } from '@/lib/utils/currency';
import {
  formatReceiptDate,
  type ReceiptSale,
  type ReceiptTenant,
} from '@/lib/sales-receipt';

function PrintStyles() {
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
