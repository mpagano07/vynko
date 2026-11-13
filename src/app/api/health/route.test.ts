import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { GET } from './route';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: supabaseMock,
}));

function healthRequest(check?: 'db'): Request {
  const qs = check ? `?check=${check}` : '';
  return new Request(`http://localhost/api/health${qs}`);
}

describe('GET /api/health', () => {
  beforeEach(() => {
    supabaseMock.__reset();
  });

  it('responde liveness sin tocar la DB', async () => {
    const res = await GET(healthRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      release: string;
      timestamp: string;
    };
    expect(body.status).toBe('ok');
    expect(body.release).toBe('dev');
    expect(new Date(body.timestamp).getTime()).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('uptime');
    expect(body).not.toHaveProperty('version');
    expect(supabaseMock.__calls.filter((c) => c.method === 'select')).toHaveLength(0);
  });

  it('responde readiness ok cuando Supabase contesta', async () => {
    supabaseMock.__queue('tenants', { data: [{ id: 't1' }], error: null });

    const res = await GET(healthRequest('db'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checks).toEqual({ database: 'ok' });
    expect(body.status).toBe('ok');
  });

  it('hace un ping liviano con timeout para no colgar el monitor', async () => {
    supabaseMock.__queue('tenants', { data: [{ id: 't1' }], error: null });

    const res = await GET(healthRequest('db'));

    expect(res.status).toBe(200);
    const select = supabaseMock.__calls.find((c) => c.method === 'select');
    expect(select?.args[1]).toEqual({ head: true });
    const abort = supabaseMock.__calls.find((c) => c.method === 'abortSignal');
    expect(abort?.args[0]).toBeInstanceOf(AbortSignal);
  });

  it('devuelve 503 cuando la DB no responde', async () => {
    supabaseMock.__queue('tenants', { data: null, error: { message: 'db down' } });

    const res = await GET(healthRequest('db'));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.checks).toEqual({ database: 'error' });
    expect(body.status).toBe('degraded');
  });
});