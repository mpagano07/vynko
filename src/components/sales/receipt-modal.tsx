'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPaymentMethodLabel } from '@/lib/payment-methods';
import { formatARS } from '@/lib/utils/currency';
import {
  formatReceiptDate,
  type ReceiptSale,
  type ReceiptTenant,
} from '@/lib/sales-receipt';

/**
 * Diseño del ticket por ancho de papel.
 *
 * La tipografía y el relleno escalan con el papel: pasar de 58mm a 80mm agranda
 * todo el ticket un 37,9% en vez de dejar el texto chico con márgenes más
 * anchos. La base está pensada para 58mm (2,9mm ≈ 11px) y 80mm es exactamente
 * 80/58 de eso, así que el texto corta en las mismas columnas en ambos papeles.
 */
const PAPER: Record<'58mm' | '80mm', { width: string; fontSize: string; padding: string }> = {
  // 58mm: cabezal ~48mm. 80mm: cabezal ~72mm. El relleno lateral deja el
  // contenido dentro de esa zona para no recortar los importes de la derecha.
  '58mm': { width: '58mm', fontSize: '2.9mm', padding: '4mm 5.5mm 2mm' },
  '80mm': { width: '80mm', fontSize: '4mm', padding: '4mm 7.6mm 2mm' },
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
 *
 * `@page { size: ... }` es lo que realmente cambia el papel. Sin esa regla el
 * navegador imprime en el tamaño por defecto de la impresora (A4 o el rollo del
 * driver) y escala el contenido, así que elegir 58mm u 80mm en Ajustes no
 * cambiaba nada. El alto se mide del ticket ya renderizado para que la térmica
 * corte justo después de la última línea y no gaste papel de más.
 *
 * En pantalla el portal queda fuera del viewport en lugar de `display: none`
 * porque un elemento oculto mide 0 y no se puede calcular su alto real.
 */
function PrintStyles({
  paperSize,
  pageHeightMm,
}: {
  paperSize: '58mm' | '80mm';
  pageHeightMm: number | null;
}) {
  return (
    <style>{`
      #receipt-print-portal {
        position: fixed;
        top: 0;
        left: -1000mm;
        pointer-events: none;
      }
      @media print {
        @page {
          ${pageHeightMm ? `size: ${paperSize} ${pageHeightMm}mm;` : 'size: auto;'}
          margin: 0;
        }
        html, body { background: #fff !important; }
        body > *:not(#receipt-print-portal) { display: none !important; }
        #receipt-print-portal {
          display: block !important;
          position: static !important;
          left: auto !important;
          pointer-events: auto;
        }
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
    <div style={{ padding: PAPER[paperSize].padding }}>
      <p className="text-center font-bold text-[1.09em]">{businessName}</p>
      {tenant.business_address && (
        <p className="text-center">{tenant.business_address}</p>
      )}
      {tenant.business_phone && (
        <p className="text-center">Tel: {tenant.business_phone}</p>
      )}
      <p className="text-center mt-[0.36em]">Venta N° {sale.id.slice(0, 8).toUpperCase()}</p>
      <p className="text-center">{formatReceiptDate(sale.created_at)}</p>
      <p className="text-center border-t border-dashed border-gray-400 my-[0.36em]"></p>

      {(sale.items ?? []).map((item, idx) => (
        <div key={`${item.product_name}-${idx}`}>
          <p>
            {item.quantity} x {item.product_name}
          </p>
          {/* Con cantidad 1 el precio unitario y el subtotal son el mismo
              número: mostrarlo dos veces confunde y alarga el ticket. */}
          {item.quantity > 1 ? (
            <p className="flex justify-between">
              <span className="pl-[1.09em]">
                {formatARS(item.unit_price_cents / 100)} c/u
              </span>
              <span>{formatARS(item.subtotal_cents / 100)}</span>
            </p>
          ) : (
            <p className="text-right">{formatARS(item.subtotal_cents / 100)}</p>
          )}
        </div>
      ))}

      <p className="border-t border-dashed border-gray-400 my-[0.36em]"></p>

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
        <p className="text-[0.91em] text-gray-600">Incluye ajustes automáticos por medio de pago.</p>
      )}
      <p className="flex justify-between font-bold text-[1.18em]">
        <span>TOTAL</span>
        <span>{formatARS(sale.total_cents / 100)}</span>
      </p>

      <p className="border-t border-dashed border-gray-400 my-[0.36em]"></p>

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
              <span className="pl-[1.09em]">Vuelto</span>
              <span>-{formatARS(p.change_cents / 100)}</span>
            </p>
          )}
        </div>
      ))}

      {sale.notes && <p className="mt-[0.36em]">Nota: {sale.notes}</p>}

      <p className="text-center border-t border-dashed border-gray-400 my-[0.36em]"></p>
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
  const areaRef = useRef<HTMLDivElement>(null);
  const [pageHeightMm, setPageHeightMm] = useState<number | null>(null);

  // Mide el ticket ya renderizado (en pantalla está fuera del viewport, pero se
  // layouta) para declarar un `@page` del alto exacto del contenido.
  useLayoutEffect(() => {
    let cancelled = false;

    const measure = () => {
      const el = areaRef.current;
      if (!el) return;
      const heightPx = el.getBoundingClientRect().height;
      if (heightPx <= 0) return;
      const heightMm = Math.ceil((heightPx * 25.4) / 96) + 2;
      if (!cancelled) setPageHeightMm(heightMm);
    };

    measure();
    // Las fuentes pueden terminar de cargar después del primer layout y cambiar
    // el alto: se vuelve a medir cuando están listas.
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure();
    });

    return () => {
      cancelled = true;
    };
  }, [sale, tenant, paperSize]);

  // El portal necesita `document`; el componente sólo se monta en el cliente
  // (cuando hay una venta para imprimir), pero SSR puede evaluarlo igual.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <PrintStyles paperSize={paperSize} pageHeightMm={pageHeightMm} />
      <div id="receipt-print-portal" aria-hidden="true">
        <div
          ref={areaRef}
          id="receipt-print-area"
          className="bg-white text-gray-900 font-mono leading-relaxed"
          style={{ width: PAPER[paperSize].width, fontSize: PAPER[paperSize].fontSize }}
        >
          <ReceiptBody sale={sale} tenant={tenant} paperSize={paperSize} />
        </div>
      </div>
    </>,
    document.body
  );
}
