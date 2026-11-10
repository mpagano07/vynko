'use client';

import { createPortal } from 'react-dom';
import { getPaymentMethodLabel } from '@/lib/payment-methods';
import { formatARS } from '@/lib/utils/currency';
import {
  formatReceiptDate,
  type ReceiptSale,
  type ReceiptTenant,
} from '@/lib/sales-receipt';

const PAPER_PADDING: Record<'58mm' | '80mm', string> = {
  // El cabezal de una térmica de 58mm imprime ~48mm y el de 80mm ~72mm. El
  // relleno deja el contenido dentro de esa zona: con el ancho completo del
  // papel los importes alineados a la derecha quedaban fuera del área imprimible.
  '58mm': '4mm 5.5mm 2mm',
  '80mm': '4mm 4.5mm 2mm',
};

/**
 * CSS de impresión del ticket.
 *
 * El ticket se monta por portal como hijo directo de `body` y, al imprimir, se
 * ocultan los demás hijos con `display: none`. Antes se usaba
 * `body * { visibility: hidden }`, que deja el layout del resto de la app: con
 * la página scrolleada el ticket quedaba posicionado fuera del área que Chrome
 * manda a la impresora y en 58mm la hoja salía completamente en blanco. Sin el
 * resto del layout, el único contenido es el ticket, siempre al tope de la hoja.
 */
function PrintStyles() {
  return (
    <style>{`
      #receipt-print-portal { display: none; }
      @media print {
        @page { margin: 0; }
        html, body { background: #fff !important; }
        body > *:not(#receipt-print-portal) { display: none !important; }
        #receipt-print-portal { display: block !important; }
        #receipt-print-area {
          margin: 0 !important;
          border: none !important;
          box-shadow: none !important;
        }
      }
    `}</style>
  );
}

function ReceiptBody({
  sale,
  tenant,
  paperSize,
}: {
  sale: ReceiptSale;
  tenant: ReceiptTenant;
  paperSize: '58mm' | '80mm';
}) {
  const businessName = tenant.company_name || tenant.name || '';
  const hasAdjustments = Object.values(sale.adjustments_applied ?? {}).some((v) => v !== 0);

  return (
    <div style={{ padding: PAPER_PADDING[paperSize] }}>
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
  // El portal necesita `document`; el componente sólo se monta en el cliente
  // (cuando hay una venta para imprimir), pero SSR puede evaluarlo igual.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <PrintStyles />
      <div id="receipt-print-portal" aria-hidden="true">
        <div
          id="receipt-print-area"
          className="bg-white text-gray-900 font-mono text-[11px] leading-relaxed"
          style={{ width: paperSize }}
        >
          <ReceiptBody sale={sale} tenant={tenant} paperSize={paperSize} />
        </div>
      </div>
    </>,
    document.body
  );
}
