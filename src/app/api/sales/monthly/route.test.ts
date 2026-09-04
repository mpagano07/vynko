import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { GET } from './route';

const mockAuth = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  allTenants: false,
  tenantIds: ['tenant-1'],
};

vi.mock('@/lib/api-auth', () => ({
  getAuth: vi.fn(async () => mockAuth),
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

function makeRequest(): Request {
  return new Request('http://localhost/api/sales/monthly', { method: 'GET' });
}

describe('GET /api/sales/monthly', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('agrega en la base sum y count de ventas del mes', async () => {
    supabaseMock.__queue('sales_monthly_totals', { data: [{ total: 125000, sale_count: 5 }] });
    supabaseMock.__queue('sales_monthly_totals', { data: [{ total: 100000, sale_count: 4 }] });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.total).toBe(1250);
    expect(json.saleCount).toBe(5);
    expect(json.prevTotal).toBe(1000);
    expect(json.prevSaleCount).toBe(4);
    expect(json.variationPercent).toBe(25);
    expect(json.avgTicket).toBe(250);

    const selects = supabaseMock.__calls.filter(
      (c) => c.table === 'sales_monthly_totals' && c.method === 'select'
    );
    expect(selects).toHaveLength(2);

    const monthEqs = supabaseMock.__calls.filter(
      (c) => c.table === 'sales_monthly_totals' && c.method === 'eq' && c.args[0] === 'month'
    );
    expect(monthEqs).toHaveLength(2);
  });

  it('devuelve variationPercent null cuando el mes previo es 0', async () => {
    supabaseMock.__queue('sales_monthly_totals', { data: [{ total: 5000, sale_count: 1 }] });
    supabaseMock.__queue('sales_monthly_totals', { data: [{ total: 0, sale_count: 0 }] });

    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json.variationPercent).toBeNull();
    expect(json.avgTicket).toBe(50);
  });

  it('no filtra por tenant cuando el usuario ve todas las sucursales', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce({ ...mockAuth, allTenants: true });
    supabaseMock.__queue('sales_monthly_totals', { data: [{ total: 1000, sale_count: 1 }] });
    supabaseMock.__queue('sales_monthly_totals', { data: [{ total: 1000, sale_count: 1 }] });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const tenantEqs = supabaseMock.__calls.filter(
      (c) => c.table === 'sales_monthly_totals' && c.method === 'eq' && c.args[0] === 'tenant_id'
    );
    expect(tenantEqs).toHaveLength(0);
  });

  it('filtra por tenant para un usuario de una sola sucursal', async () => {
    supabaseMock.__queue('sales_monthly_totals', { data: [{ total: 1000, sale_count: 1 }] });
    supabaseMock.__queue('sales_monthly_totals', { data: [{ total: 1000, sale_count: 1 }] });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const tenantEqs = supabaseMock.__calls.filter(
      (c) => c.table === 'sales_monthly_totals' && c.method === 'eq' && c.args[0] === 'tenant_id'
    );
    expect(tenantEqs.length).toBeGreaterThan(0);
    for (const call of tenantEqs) expect(call.args[1]).toBe('tenant-1');
  });

  it('devuelve valores vacíos cuando no hay datos', async () => {
    supabaseMock.__queue('sales_monthly_totals', { data: [] });
    supabaseMock.__queue('sales_monthly_totals', { data: [] });

    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json.total).toBe(0);
    expect(json.saleCount).toBe(0);
  });

  it('devuelve 500 cuando la consulta falla', async () => {
    supabaseMock.__queue('sales_monthly_totals', { data: null, error: { message: 'boom' } });
    supabaseMock.__queue('sales_monthly_totals', { data: [{ total: 1000, sale_count: 1 }] });

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Ocurrio un error inesperado. Intenta de nuevo.');
  });

  it('devuelve 500 cuando getAuth lanza una excepción', async () => {
    vi.mocked(getAuth).mockRejectedValueOnce(new Error('boom'));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('boom');
  });
});
