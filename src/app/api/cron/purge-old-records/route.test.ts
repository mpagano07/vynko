import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const { fromMock, deleteMock, ltMock } = vi.hoisted(() => {
  const lt = vi.fn();
  const del = vi.fn(() => ({ lt }));
  const from = vi.fn((_table: string) => ({ delete: del }));
  return { fromMock: from, deleteMock: del, ltMock: lt };
});

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: { from: fromMock } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

const ORIGINAL_SECRET = process.env.CRON_SECRET;
const ORIGINAL_INTERNAL_SECRET = process.env.INTERNAL_CRON_SECRET;

const request = (method: 'GET' | 'POST', authorization?: string) =>
  new Request('http://localhost/api/cron/purge-old-records', {
    method,
    headers: authorization ? { authorization } : {},
  });

describe('/api/cron/purge-old-records', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    delete process.env.INTERNAL_CRON_SECRET;
    fromMock.mockReset();
    deleteMock.mockReset();
    ltMock.mockReset();
    fromMock.mockImplementation(() => ({ delete: deleteMock }));
    deleteMock.mockImplementation(() => ({ lt: ltMock }));
    ltMock.mockResolvedValue({ error: null, count: 2 });
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
    if (ORIGINAL_INTERNAL_SECRET === undefined) delete process.env.INTERNAL_CRON_SECRET;
    else process.env.INTERNAL_CRON_SECRET = ORIGINAL_INTERNAL_SECRET;
    vi.restoreAllMocks();
  });

  it.each(['GET', 'POST'] as const)('%s purga ambas tablas con el bearer correcto', async (method) => {
    const handler = method === 'GET' ? GET : POST;
    const response = await handler(request(method, 'Bearer test-secret'));

    expect(response.status).toBe(200);
    expect(fromMock.mock.calls.map(([table]) => table)).toEqual([
      'activity_logs',
      'stock_transfers',
    ]);
    expect(deleteMock).toHaveBeenCalledWith({ count: 'exact' });
    expect(ltMock).toHaveBeenCalledWith('created_at', expect.any(String));
    expect(await response.json()).toMatchObject({
      ok: true,
      deleted: { activity_logs: 2, stock_transfers: 2 },
    });
  });

  it('rechaza el cron de Vercel sin el secreto', async () => {
    const res = await GET(request('GET'));

    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
