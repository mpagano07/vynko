import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { createActivityLog } from '@/lib/activity-log';
import { supabaseMock } from '@/test/supabase-mock';
import { GET, POST } from './route';
import { POST as closePOST } from './[id]/close/route';

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

vi.mock('@/lib/activity-log', () => ({
  createActivityLog: vi.fn(async () => undefined),
}));

function makeRequest(url: string, body?: unknown): Request {
  return new Request(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/cash-register', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve la sesión abierta con su resumen y el historial', async () => {
    supabaseMock.__queue('cash_register_sessions', {
      data: { id: 'sess-1', initial_fund_cents: 5000, status: 'open' },
    });
    supabaseMock.__queue('cash_register_sessions', {
      data: [{ id: 'old-1', status: 'closed', total_difference_cents: 0 }],
    });
    supabaseMock.__queue('cash_register_sessions', {
      data: { id: 'sess-1', initial_fund_cents: 5000 },
    });
    supabaseMock.__queue('sales', { data: [{ id: 's1' }] });
    supabaseMock.__queue('sale_payments', {
      data: [
        { method: 'cash', amount_cents: 1000 },
        { method: 'transfer', amount_cents: 2500 },
      ],
    });
    supabaseMock.__queue('cash_movements', { data: [] });
    supabaseMock.__queue('sales', {
      data: [{ id: 's1', total_cents: 3500, status: 'completed' }],
    });
    supabaseMock.__queue('cash_movements', { data: [{ id: 'm1', amount_cents: 500, type: 'in', reason: 'cambio' }] });

    const res = await GET(makeRequest('http://localhost/api/cash-register'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.open.id).toBe('sess-1');
    expect(json.open.sales_count).toBe(1);
    expect(json.open.sales_total).toBe(3500);
    expect(json.open.total_expected).toBe(8500);
    expect(json.open.expected_by_method.cash).toBe(6000);
    expect(json.open.expected_by_method.transfer).toBe(2500);
    expect(json.open.movements).toHaveLength(1);
    expect(json.history).toHaveLength(1);
  });
});

describe('POST /api/cash-register', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('abre una caja con fondo inicial', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ role: 'member' }] });
    supabaseMock.__queue('cash_register_sessions', { data: null });
    supabaseMock.__queue('cash_register_sessions', {
      data: { id: 'sess-1', initial_fund_cents: 50000 },
      error: null,
    });

    const res = await POST(makeRequest('http://localhost/api/cash-register', { initial_fund: 500 }));
    expect(res.status).toBe(201);

    const insert = supabaseMock.__calls.find(
      (c) => c.table === 'cash_register_sessions' && c.method === 'insert'
    );
    expect(insert?.args[0]).toMatchObject({
      tenant_id: 'tenant-1',
      opened_by: 'user-1',
      initial_fund_cents: 50000,
      status: 'open',
    });
    expect(createActivityLog).toHaveBeenCalled();
  });

  it('rechaza abrir si ya hay una caja abierta', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ role: 'member' }] });
    supabaseMock.__queue('cash_register_sessions', { data: { id: 'open-1' } });

    const res = await POST(makeRequest('http://localhost/api/cash-register', { initial_fund: 100 }));
    expect(res.status).toBe(409);
  });

  it('rechaza un fondo inicial inválido', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ role: 'member' }] });

    const res = await POST(makeRequest('http://localhost/api/cash-register', { initial_fund: -5 }));
    expect(res.status).toBe(400);
  });

  it('rechaza apertura para un viewer', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ role: 'viewer' }] });

    const res = await POST(makeRequest('http://localhost/api/cash-register', { initial_fund: 100 }));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/cash-register/[id]/close', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('cierra la caja y devuelve el reporte de arqueo ciego', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ role: 'manager' }] });
    supabaseMock.__queue('cash_register_sessions', {
      data: { id: 'sess-1', initial_fund_cents: 5000, status: 'open' },
    });
    supabaseMock.__queue('cash_register_sessions', {
      data: { id: 'sess-1', initial_fund_cents: 5000 },
    });
    supabaseMock.__queue('sales', { data: [{ id: 's1' }] });
    supabaseMock.__queue('sale_payments', {
      data: [
        { method: 'cash', amount_cents: 1200 },
        { method: 'credit', amount_cents: 3000 },
      ],
    });
    supabaseMock.__queue('cash_movements', {
      data: [{ id: 'm1', type: 'out', amount_cents: 1000 }],
    });
    supabaseMock.__queue('cash_register_sessions', {
      data: {
        id: 'sess-1',
        status: 'closed',
        total_expected_cents: 8200,
        total_counted_cents: 9000,
        total_difference_cents: 800,
        expected_by_method: {},
        counted_by_method: {},
        difference_by_method: {},
      },
      error: null,
    });

    const res = await closePOST(
      makeRequest(
        'http://localhost/api/cash-register/sess-1/close',
        { counted: { cash: 70, credit: 20, transfer: 0, debit: 0, mercadopago: 0 } }
      )
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.report.total_expected_cents).toBe(8200);
    expect(json.report.total_counted_cents).toBe(9000);
    expect(json.report.total_difference_cents).toBe(800);
    expect(json.report.difference_by_method.cash).toBe(1800);

    const update = supabaseMock.__calls.find(
      (c) => c.table === 'cash_register_sessions' && c.method === 'update'
    );
    expect(update?.args[0]).toMatchObject({
      status: 'closed',
      closed_by: 'user-1',
      expected_by_method: { cash: 5200, credit: 3000, transfer: 0, debit: 0, mercadopago: 0 },
      counted_by_method: { cash: 7000, credit: 2000, transfer: 0, debit: 0, mercadopago: 0 },
    });
    expect(createActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'Caja cerrada' })
    );
  });

  it('rechaza cerrar cuando no hay caja abierta', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ role: 'manager' }] });
    supabaseMock.__queue('cash_register_sessions', { data: null });

    const res = await closePOST(
      makeRequest('http://localhost/api/cash-register/sess-9/close', {
        counted: { cash: 10 },
      })
    );
    expect(res.status).toBe(404);
  });

  it('rechaza cerrar sin monto contado', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ role: 'manager' }] });
    supabaseMock.__queue('cash_register_sessions', {
      data: { id: 'sess-1', initial_fund_cents: 0, status: 'open' },
    });

    const res = await closePOST(
      makeRequest('http://localhost/api/cash-register/sess-1/close', { counted: {} })
    );
    expect(res.status).toBe(400);
  });
});