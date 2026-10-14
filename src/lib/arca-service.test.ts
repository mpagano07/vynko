import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveVoucherType,
  allocateProportionally,
  resolveCreditNoteType,
  isSandboxInvoice,
  createElectronicInvoice,
  createCreditNote,
} from './arca-service';
import type { AuthInfo } from '@/lib/api-auth';
import { canUseFacturacionForUser } from '@/lib/arca/access-server';

// La feature es sólo para la cuenta admin mientras dure la prueba; se mockea el
// chequeo para poder testear el resto del servicio sin pegarle a Supabase.
vi.mock('@/lib/arca/access-server', () => ({
  canUseFacturacionForUser: vi.fn(),
}));

const auth = { tenantId: 't1', userId: 'u1', allTenants: false, tenantIds: ['t1'] } as AuthInfo;

beforeEach(() => {
  vi.mocked(canUseFacturacionForUser).mockReset();
  vi.mocked(canUseFacturacionForUser).mockResolvedValue(true);
});

describe('resolveVoucherType', () => {
  describe('emisor Responsable Inscripto', () => {
    it('emite A ante otro Responsable Inscripto', () => {
      expect(resolveVoucherType('responsable_inscripto', 'responsable_inscripto')).toEqual({
        voucherType: 1,
        invoiceTypeStr: 'A',
      });
    });

    it('emite B ante consumidor final, monotributista o exento', () => {
      for (const receptor of ['consumidor_final', 'monotributista', 'sujeto_exento']) {
        expect(resolveVoucherType('responsable_inscripto', receptor)).toEqual({
          voucherType: 6,
          invoiceTypeStr: 'B',
        });
      }
    });

    it('respeta el tipo pedido cuando es de serie A o B', () => {
      expect(resolveVoucherType('responsable_inscripto', 'responsable_inscripto', 'A')).toEqual({
        voucherType: 1,
        invoiceTypeStr: 'A',
      });
      expect(resolveVoucherType('responsable_inscripto', 'responsable_inscripto', 'NC_A')).toEqual({
        voucherType: 3,
        invoiceTypeStr: 'NC_A',
      });
      expect(resolveVoucherType('responsable_inscripto', 'consumidor_final', 'ND_B')).toEqual({
        voucherType: 7,
        invoiceTypeStr: 'ND_B',
      });
    });

    it('rechaza la serie C: cae al tipo válido según el receptor', () => {
      expect(resolveVoucherType('responsable_inscripto', 'responsable_inscripto', 'C')).toEqual({
        voucherType: 1,
        invoiceTypeStr: 'A',
      });
      expect(resolveVoucherType('responsable_inscripto', 'consumidor_final', 'C')).toEqual({
        voucherType: 6,
        invoiceTypeStr: 'B',
      });
    });
  });

  describe('emisor no Responsable Inscripto', () => {
    it('monotributista siempre emite C', () => {
      expect(resolveVoucherType('monotributista', 'consumidor_final')).toEqual({
        voucherType: 11,
        invoiceTypeStr: 'C',
      });
      expect(resolveVoucherType('monotributista', 'responsable_inscripto')).toEqual({
        voucherType: 11,
        invoiceTypeStr: 'C',
      });
    });

    it('ignora un pedido de serie A para un monotributista', () => {
      expect(resolveVoucherType('monotributista', 'responsable_inscripto', 'A')).toEqual({
        voucherType: 11,
        invoiceTypeStr: 'C',
      });
      expect(resolveVoucherType('monotributista', 'consumidor_final', 'NC_A')).toEqual({
        voucherType: 11,
        invoiceTypeStr: 'C',
      });
    });

    it('respeta Notas de Crédito / Débito de la serie C', () => {
      expect(resolveVoucherType('monotributista', 'consumidor_final', 'NC_C')).toEqual({
        voucherType: 13,
        invoiceTypeStr: 'NC_C',
      });
      expect(resolveVoucherType('monotributista', 'consumidor_final', 'ND_C')).toEqual({
        voucherType: 12,
        invoiceTypeStr: 'ND_C',
      });
    });

    it('un sujeto exento emite serie C', () => {
      expect(resolveVoucherType('sujeto_exento', 'consumidor_final')).toEqual({
        voucherType: 11,
        invoiceTypeStr: 'C',
      });
    });

    it('ignora tipos desconocidos', () => {
      expect(resolveVoucherType('monotributista', 'consumidor_final', 'XYZ')).toEqual({
        voucherType: 11,
        invoiceTypeStr: 'C',
      });
    });
  });
});

describe('allocateProportionally', () => {
  it('reparte el importe proporcionalmente al peso de cada línea', () => {
    // 200 de un total de 800 => 50 (1/4), 150 (3/4), 0
    expect(allocateProportionally([100, 300, 400], 200)).toEqual([25, 75, 100]);
  });

  it('garantiza que la suma de las partes sea exactamente el importe', () => {
    const shares = allocateProportionally([1, 1, 1], 100);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('reparte el residuo de redondeo entre las líneas con mayor fracción', () => {
    const shares = allocateProportionally([1, 1, 1], 10);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });

  it('devuelve ceros cuando el importe es cero o negativo', () => {
    expect(allocateProportionally([100, 200], 0)).toEqual([0, 0]);
    expect(allocateProportionally([100, 200], -50)).toEqual([0, 0]);
  });

  it('devuelve ceros cuando no hay base para repartir', () => {
    expect(allocateProportionally([0, 0], 100)).toEqual([0, 0]);
    expect(allocateProportionally([], 100)).toEqual([]);
  });

  it('asigna todo el importe a una única línea', () => {
    expect(allocateProportionally([7345], 900)).toEqual([900]);
  });
});

describe('resolveCreditNoteType', () => {
  it('mapea cada serie de factura a su Nota de Crédito', () => {
    expect(resolveCreditNoteType('A')).toBe('NC_A');
    expect(resolveCreditNoteType('B')).toBe('NC_B');
    expect(resolveCreditNoteType('C')).toBe('NC_C');
  });

  it('no acredita comprobantes que ya son notas o tipos desconocidos', () => {
    expect(resolveCreditNoteType('NC_A')).toBeNull();
    expect(resolveCreditNoteType('ND_B')).toBeNull();
    expect(resolveCreditNoteType('XYZ')).toBeNull();
  });
});

describe('createElectronicInvoice', () => {
  it('rechaza emitir una Nota de Crédito sin factura que la acredite', async () => {
    const res = await createElectronicInvoice(auth, {
      customer_name: 'Cliente',
      invoice_type: 'NC_A',
      items: [{ description: 'Producto', quantity: 1, unit_price_cents: 100 }],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/acreditando una factura/);
    }
  });

  it('rechaza la emisión (403) si la cuenta no tiene la facturación habilitada', async () => {
    vi.mocked(canUseFacturacionForUser).mockResolvedValue(false);

    const res = await createElectronicInvoice(auth, {
      customer_name: 'Cliente',
      invoice_type: 'B',
      items: [{ description: 'Producto', quantity: 1, unit_price_cents: 100 }],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.error).toMatch(/no está habilitada/);
    }
  });
});

describe('createCreditNote', () => {
  it('rechaza la emisión (403) si la cuenta no tiene la facturación habilitada', async () => {
    vi.mocked(canUseFacturacionForUser).mockResolvedValue(false);

    const res = await createCreditNote(auth, 'inv-1');

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.error).toMatch(/no está habilitada/);
    }
  });
});

describe('isSandboxInvoice', () => {
  it('detecta comprobantes emitidos en Modo Sandbox', () => {
    expect(isSandboxInvoice({ afip_response: { sandbox: true } })).toBe(true);
  });

  it('no marca comprobantes reales ni respuestas sin el flag', () => {
    expect(isSandboxInvoice({ afip_response: { sandbox: false } })).toBe(false);
    expect(isSandboxInvoice({ afip_response: { authorized_at: '2026-01-01' } })).toBe(false);
    expect(isSandboxInvoice({ afip_response: null })).toBe(false);
    expect(isSandboxInvoice({})).toBe(false);
    expect(isSandboxInvoice(null)).toBe(false);
    expect(isSandboxInvoice(undefined)).toBe(false);
  });
});
