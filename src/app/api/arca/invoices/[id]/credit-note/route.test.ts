import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { createCreditNote } from '@/lib/arca-service';
import { POST } from './route';

const mockAuth = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  allTenants: false,
  tenantIds: ['tenant-1'],
};

vi.mock('@/lib/api-auth', () => ({
  getAuth: vi.fn(async () => mockAuth),
}));

vi.mock('@/lib/arca-service', () => ({
  createCreditNote: vi.fn(),
}));

function makeRequest(): Request {
  return new Request('http://localhost/api/arca/invoices/inv-1/credit-note', {
    method: 'POST',
  });
}

const params = Promise.resolve({ id: 'inv-1' });

const fakeCreditNote = {
  id: 'nc-1',
  tenant_id: 'tenant-1',
  invoice_number: 3,
  punto_venta: 1,
  invoice_type: 'NC_B',
  cuit_emisor: '20111111112',
  customer_name: 'Ana',
  document_type: 'DNI',
  document_number: '30111222',
  iva_condition: 'consumidor_final',
  total_cents: 400,
  net_cents: 400,
  iva_cents: 0,
  iva_percentage: 0,
  other_taxes_cents: 0,
  cae: '74123456789012',
  status: 'approved' as const,
  created_by: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('POST /api/arca/invoices/[id]/credit-note', () => {
  beforeEach(() => {
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
    vi.mocked(createCreditNote).mockReset();
  });

  it('emite la Nota de Crédito y devuelve el comprobante', async () => {
    vi.mocked(createCreditNote).mockResolvedValue({
      ok: true,
      data: fakeCreditNote,
      status: 201,
    });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.id).toBe('nc-1');
    expect(createCreditNote).toHaveBeenCalledWith(mockAuth, 'inv-1');
  });

  it('propaga el error del servicio con su status', async () => {
    vi.mocked(createCreditNote).mockResolvedValue({
      ok: false,
      error: 'Solo se pueden acreditar Facturas A, B o C',
      status: 400,
    });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Solo se pueden acreditar Facturas A, B o C');
  });

  it('responde 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(401);
    expect(createCreditNote).not.toHaveBeenCalled();
  });
});
