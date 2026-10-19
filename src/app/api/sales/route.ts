import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { createSale, getTodaySales, listSales } from '@/lib/sales-service';
import { createElectronicInvoice } from '@/lib/arca-service';
import type { CreateElectronicInvoiceRequest } from '@/lib/types/arca';
import { fixResponse } from '@/lib/utils/encoding';

interface SaleArcaPayload {
  emit?: boolean;
  invoice_type?: 'A' | 'B' | 'C';
  customer_name?: string;
  document_type?: 'DNI' | 'CUIT' | 'CUIL' | 'SinIdentificar';
  document_number?: string;
  iva_condition?: 'responsable_inscripto' | 'monotributista' | 'consumidor_final' | 'sujeto_exento';
  concept?: 1 | 2 | 3;
}

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const todayOnly = searchParams.get('today') === 'true';

  if (todayOnly) {
    const tz = searchParams.get('tz') || 'UTC';
    const result = await getTodaySales(auth, tz);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json(fixResponse(result.data));
  }

  const days = searchParams.get('days') ? parseInt(searchParams.get('days')!, 10) : null;
  const hasPagination = searchParams.has('page') || searchParams.has('limit') || days !== null;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '15', 10)));

  const result = await listSales(auth, { days, page, limit, hasPagination });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  if (hasPagination) {
    return NextResponse.json(fixResponse({ data: result.data, total: result.total ?? 0, page, limit }));
  }
  return NextResponse.json(fixResponse(result.data));
}

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const idempotencyKey = request.headers.get('idempotency-key');
  const result = await createSale(auth, body, idempotencyKey ?? undefined);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });

  // Emisión ARCA opcional. La venta ya quedó registrada (y el stock descontado)
  // en su propia transacción: ARCA es externo y puede fallar después. En ese
  // caso se devuelve la venta igual, con el error, para no perder el cobro; el
  // comprobante se puede reintentar desde /invoices.
  const sale = result.sale as Record<string, unknown>;
  let arca: { ok: boolean; invoice?: unknown; error?: string } | undefined;

  const arcaReq = (body as { arca?: SaleArcaPayload }).arca;
  if (arcaReq?.emit) {
    const items = ((result.items ?? []) as Array<Record<string, unknown>>).map((item) => ({
      product_id: (item.product_id as string) || undefined,
      description: (item.product_name as string) || 'Producto',
      quantity: item.quantity as number,
      unit_price_cents: item.unit_price_cents as number,
    }));

    const invoiceRequest: CreateElectronicInvoiceRequest = {
      sale_id: sale.id as string,
      customer_id: (body.customer_id as string) || undefined,
      customer_name: arcaReq.customer_name?.trim() || 'Consumidor Final',
      document_type: arcaReq.document_type,
      document_number: arcaReq.document_number,
      iva_condition: arcaReq.iva_condition,
      invoice_type: arcaReq.invoice_type,
      concept: arcaReq.concept,
      items,
      discount_cents: Number(sale.discount_cents) || 0,
      surcharge_cents: Number(sale.surcharge_cents) || 0,
    };

    const invResult = await createElectronicInvoice(auth, invoiceRequest);
    arca = invResult.ok
      ? { ok: true, invoice: invResult.data }
      : { ok: false, error: invResult.error };
  }

  return NextResponse.json(
    {
      ...result.sale,
      items: result.items,
      payments: result.payments,
      adjustments_applied: result.adjustments_applied,
      ...(arca ? { arca } : {}),
    },
    { status: 201 }
  );
}