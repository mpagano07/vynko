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

function makeRequest(days = 7): Request {
  return new Request(`http://localhost/api/sales/summary?days=${days}`, { method: 'GET' });
}

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

describe('GET /api/sales/summary', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin autenticación', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('agrega por día en la base y completa los días sin ventas', async () => {
    const today = isoDay(0);
    const yesterday = isoDay(1);
    supabaseMock.__queue('sales_daily_totals', {
      data: [
        { day: yesterday, total: 5000 },
        { day: today, total: 7000 },
      ],
    });

    const res = await GET(makeRequest(7));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(7);

    const todayRow = json.find((r: { date: string }) => r.date === today);
    const yesterdayRow = json.find((r: { date: string }) => r.date === yesterday);
    expect(todayRow.total).toBe(70);
    expect(yesterdayRow.total).toBe(50);

    const empty = json.filter((r: { total: number }) => r.total === 0);
    expect(empty).toHaveLength(5);

    const select = supabaseMock.__calls.find(
      (c) => c.table === 'sales_daily_totals' && c.method === 'select'
    );
    expect(select?.args[0]).toBe('day, total');

    const gte = supabaseMock.__calls.find(
      (c) => c.table === 'sales_daily_totals' && c.method === 'gte'
    );
    expect(gte?.args[0]).toBe('day');
  });

  it('usa 7 días por defecto', async () => {
    supabaseMock.__queue('sales_daily_totals', { data: [] });
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json).toHaveLength(7);
  });

  it('acepta 30, 90 y 365 días', async () => {
    for (const days of [30, 90, 365]) {
      supabaseMock.__queue('sales_daily_totals', { data: [] });
      const res = await GET(makeRequest(days));
      const json = await res.json();
      expect(json).toHaveLength(days);
    }
  });

  it('etiqueta días cortos para ventanas <=31 días y fecha+mes para más', async () => {
    supabaseMock.__queue('sales_daily_totals', { data: [] });
    const short = await (await GET(makeRequest(7))).json();
    for (const r of short) {
      expect(/^(Dom|Lun|Mar|Mié|Jue|Vie|Sáb)$/.test(r.day)).toBe(true);
    }

    supabaseMock.__queue('sales_daily_totals', { data: [] });
    const long = await (await GET(makeRequest(90))).json();
    for (const r of long) {
      expect(/^\d+ (Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)$/.test(r.day)).toBe(true);
    }
  });

  it('no filtra por tenant cuando el usuario ve todas las sucursales', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce({ ...mockAuth, allTenants: true });
    supabaseMock.__queue('sales_daily_totals', { data: [] });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const tenantEqs = supabaseMock.__calls.filter(
      (c) => c.table === 'sales_daily_totals' && c.method === 'eq' && c.args[0] === 'tenant_id'
    );
    expect(tenantEqs).toHaveLength(0);
  });

  it('filtra por tenant para un usuario de una sola sucursal', async () => {
    supabaseMock.__queue('sales_daily_totals', { data: [] });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const tenantEqs = supabaseMock.__calls.filter(
      (c) => c.table === 'sales_daily_totals' && c.method === 'eq' && c.args[0] === 'tenant_id'
    );
    expect(tenantEqs.length).toBeGreaterThan(0);
    for (const call of tenantEqs) expect(call.args[1]).toBe('tenant-1');
  });

  it('devuelve 500 cuando la consulta falla', async () => {
    supabaseMock.__queue('sales_daily_totals', { data: null, error: { message: 'boom' } });
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
