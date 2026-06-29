import type { AfipInvoiceRequest, AfipCaeResponse } from '@/lib/types/invoice';

const MOCK_MODE = process.env.NEXT_PUBLIC_AFIP_MOCK !== 'false';

function generateMockCae(): string {
  const digits = Array.from({ length: 13 }, () => Math.floor(Math.random() * 10));
  return digits.join('');
}

function generateMockCaeDueDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

export async function requestCae(
  config: { cuit: string; punto_venta: number },
  invoice: AfipInvoiceRequest
): Promise<{ success: boolean; data?: AfipCaeResponse; error?: string }> {
  if (MOCK_MODE) {
    return {
      success: true,
      data: {
        cae: generateMockCae(),
        cae_due_date: generateMockCaeDueDate(),
        invoice_number: 0,
        result: 'A',
      },
    };
  }

  try {
    const auth = await authenticateAfip();
    const response = await soapRequest(auth, config, invoice);
    return { success: true, data: response };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al comunicarse con AFIP';
    return { success: false, error: message };
  }
}

export async function cancelCae(
  config: { cuit: string; punto_venta: number },
  invoice: { invoice_number: number; invoice_type: string; motivo: string }
): Promise<{ success: boolean; data?: AfipCaeResponse; error?: string }> {
  if (MOCK_MODE) {
    return {
      success: true,
      data: {
        cae: generateMockCae(),
        cae_due_date: generateMockCaeDueDate(),
        invoice_number: invoice.invoice_number,
        result: 'A',
      },
    };
  }

  return { success: false, error: 'Cancelación real de AFIP no implementada. Configurar certificados.' };
}

export function getInvoiceTotals(
  items: { unit_price_cents: number; quantity: number; iva_percentage?: number }[],
  invoiceType: string
): { net_cents: number; iva_cents: number; total_cents: number } {
  const total_cents = items.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);

  if (invoiceType === 'C') {
    return { net_cents: total_cents, iva_cents: 0, total_cents };
  }

  if (invoiceType === 'A') {
    let netoCents = 0;
    let ivaCents = 0;
    for (const item of items) {
      const pct = item.iva_percentage ?? 21;
      const subtotal = item.unit_price_cents * item.quantity;
      const neto = Math.round(subtotal / (1 + pct / 100));
      netoCents += neto;
      ivaCents += subtotal - neto;
    }
    return { net_cents: netoCents, iva_cents: ivaCents, total_cents };
  }

  const ivaPorc = 21;
  const netoCents = Math.round(total_cents / (1 + ivaPorc / 100));
  const ivaCents = total_cents - netoCents;
  return { net_cents: netoCents, iva_cents: ivaCents, total_cents };
}

async function authenticateAfip(): Promise<string> {
  throw new Error(
    'AFIP real requires WSAA authentication with certificate. Set NEXT_PUBLIC_AFIP_MOCK=false and configure AFIP_* env vars.'
  );
}

async function soapRequest(
  _auth: string,
  _config: { cuit: string; punto_venta: number },
  _invoice: AfipInvoiceRequest
): Promise<AfipCaeResponse> {
  void _auth;
  void _config;
  void _invoice;
  throw new Error('AFIP SOAP request not implemented. Use mock mode for development.');
}

export type { AfipInvoiceRequest, AfipCaeResponse };
