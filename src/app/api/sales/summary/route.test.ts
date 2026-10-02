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

function makeMonthsRequest(months: number): Request {
  return new Request(`http://localhost/api/sales/summary?months=${months}`, { method: 'GET' });
}

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Clave `YYYY-MM-01` del mes situado `offset` meses antes que el actual (0 = mes en curso). */
function isoMonth(offset: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
    .toISOString()
    .slice(0, 10);
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

  it('filtra con in() cuando el usuario ve todas las sucursales', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce({ ...mockAuth, allTenants: true, tenantIds: ['tenant-1', 'tenant-2'] });
    supabaseMock.__queue('sales_daily_totals', { data: [] });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const tenantIns = supabaseMock.__calls.filter(
      (c) => c.table === 'sales_daily_totals' && c.method === 'in' && c.args[0] === 'tenant_id'
    );
    expect(tenantIns).toHaveLength(1);
    expect(tenantIns[0].args[1]).toEqual(['tenant-1', 'tenant-2']);
  });

  it('filtra por tenant para un usuario de una sola sucursal', async () => {
    supabaseMock.__queue('sales_daily_totals', { data: [] });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const tenantIns = supabaseMock.__calls.filter(
      (c) => c.table === 'sales_daily_totals' && c.method === 'in' && c.args[0] === 'tenant_id'
    );
    expect(tenantIns.length).toBeGreaterThan(0);
    for (const call of tenantIns) expect(call.args[1]).toEqual(['tenant-1']);
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

describe('GET /api/sales/summary?months=', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve una barra por mes con la suma completa del mes', async () => {
    supabaseMock.__queue('sales_monthly_totals', {
      data: [
        { month: isoMonth(11), total: 40000, sale_count: 4 },
        { month: isoMonth(1), total: 50000, sale_count: 5 },
        { month: isoMonth(0), total: 60000, sale_count: 6 },
      ],
    });

    const res = await GET(makeMonthsRequest(12));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(12);

    expect(json[0]).toMatchObject({ date: isoMonth(11), total: 400, saleCount: 4, partial: false });
    expect(json[10]).toMatchObject({ date: isoMonth(1), total: 500, saleCount: 5, partial: false });
    // El ultimo bucket es el mes en curso: esta incompleto.
    expect(json[11]).toMatchObject({ date: isoMonth(0), total: 600, saleCount: 6, partial: true });

    const select = supabaseMock.__calls.find(
      (c) => c.table === 'sales_monthly_totals' && c.method === 'select'
    );
    expect(select?.args[0]).toBe('month, total, sale_count');
    const gte = supabaseMock.__calls.find(
      (c) => c.table === 'sales_monthly_totals' && c.method === 'gte'
    );
    expect(gte?.args).toEqual(['month', isoMonth(11)]);
  });

  it('cae en 12 meses cuando el parametro no es valido', async () => {
    for (const months of [0, 3, 365, Number.NaN]) {
      supabaseMock.__queue('sales_monthly_totals', { data: [] });
      const json = await (await GET(makeMonthsRequest(months))).json();
      expect(json).toHaveLength(12);
      expect(json[0].date).toBe(isoMonth(11));
    }
  });

  it('omite meses sin ventas para que el eje quede parejo', async () => {
    supabaseMock.__queue('sales_monthly_totals', {
      data: [{ month: isoMonth(0), total: 25000, sale_count: 2 }],
    });
    const json = await (await GET(makeMonthsRequest(12))).json();
    expect(json.slice(0, 11).every((r: { total: number }) => r.total === 0)).toBe(true);
    expect(json[11].total).toBe(250);
  });

  it('ignora meses fuera de la ventana consultada', async () => {
    supabaseMock.__queue('sales_monthly_totals', {
      data: [{ month: isoMonth(12), total: 999000, sale_count: 9 }],
    });
    const json = await (await GET(makeMonthsRequest(12))).json();
    expect(json.every((r: { total: number }) => r.total === 0)).toBe(true);
  });

  it('etiqueta cada mes con nombre corto y nombre largo con año', async () => {
    supabaseMock.__queue('sales_monthly_totals', { data: [] });
    const json = await (await GET(makeMonthsRequest(12))).json();
    for (const row of json) {
      expect(/^(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)$/.test(row.day)).toBe(true);
      expect(/^[a-zá-ú]+ \d{4}$/.test(row.label)).toBe(true);
      expect(row.label.endsWith(String(new Date(row.date).getUTCFullYear()))).toBe(true);
    }
  });

  it('filtra por sucursal con in() también en la vista mensual', async () => {
    vi.mocked(getAuth).mockResolvedValueOnce({
      ...mockAuth, allTenants: true, tenantIds: ['tenant-1', 'tenant-2'],
    });
    supabaseMock.__queue('sales_monthly_totals', { data: [] });
    const res = await GET(makeMonthsRequest(12));
    expect(res.status).toBe(200);

    const tenantIns = supabaseMock.__calls.filter(
      (c) => c.table === 'sales_monthly_totals' && c.method === 'in' && c.args[0] === 'tenant_id'
    );
    expect(tenantIns).toHaveLength(1);
    expect(tenantIns[0].args[1]).toEqual(['tenant-1', 'tenant-2']);
  });

  it('devuelve 500 cuando la consulta mensual falla', async () => {
    supabaseMock.__queue('sales_monthly_totals', { data: null, error: { message: 'boom' } });
    const res = await GET(makeMonthsRequest(12));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Ocurrio un error inesperado. Intenta de nuevo.');
  });
});
