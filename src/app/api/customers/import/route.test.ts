import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { __resetRateLimitStateForTests } from '@/lib/rate-limit';
import { POST } from './route';

const mockAuth = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  allTenants: false,
  tenantIds: ['tenant-1'],
};

const guardKillMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({ getAuth: vi.fn(async () => mockAuth) }));
vi.mock('@/lib/kill-switch', () => ({ guardKill: guardKillMock }));
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));
vi.mock('@/lib/activity-log', () => ({ createActivityLog: vi.fn(async () => undefined) }));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/customers/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

type ImportEvent = Record<string, unknown> & { type: string };

async function readNdjson(res: Response): Promise<ImportEvent[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as ImportEvent);
}

function doneEvent(events: ImportEvent[]): ImportEvent {
  const done = events.find((event) => event.type === 'done');
  if (!done) throw new Error('no llego el evento done');
  return done;
}

describe('POST /api/customers/import', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
    guardKillMock.mockResolvedValue(null);
  });

  it('devuelve 503 cuando el kill switch de importaciones esta activo', async () => {
    guardKillMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'KILL_SWITCH_IMPORTS' }), { status: 503 }),
    );

    const res = await POST(makeRequest({ customers: [{ name: 'Juan' }] }));

    expect(res.status).toBe(503);
    expect(guardKillMock).toHaveBeenCalledWith('imports');
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('devuelve 401 sin sesion', async () => {
    vi.mocked(getAuth).mockResolvedValue(null);
    const res = await POST(makeRequest({ customers: [{ name: 'Juan' }] }));
    expect(res.status).toBe(401);
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('devuelve 400 si no viene ninguna lista de clientes', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No rows provided' });
  });

  it('devuelve 400 con la lista vacia', async () => {
    const res = await POST(makeRequest({ customers: [] }));
    expect(res.status).toBe(400);
  });

  it('responde con el reporte fila por fila y el resumen', async () => {
    // Lectura de existentes -> ninguno; alta -> ok.
    supabaseMock.__queue('customers', { data: [], error: null });
    supabaseMock.__queue('customers', { data: { id: 'cust-1' }, error: null });

    const res = await POST(
      makeRequest({
        customers: [{ name: 'Juan Pérez', email: 'juan@ejemplo.com' }, { name: '' }],
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const events = await readNdjson(res);
    const done = doneEvent(events);
    expect(done.summary).toEqual({ created: 1, updated: 0, skipped: 1, total: 2 });
    expect(done.results).toHaveLength(2);
    expect((done.results as unknown[])[1]).toMatchObject({
      row: 2,
      status: 'skipped',
      error: 'Nombre requerido',
    });
  });

  it('streamea el progreso fila por fila y termina con el evento done', async () => {
    supabaseMock.__queue('customers', { data: [], error: null });
    supabaseMock.__queue(
      'customers',
      { data: { id: 'cust-1' }, error: null },
      { data: { id: 'cust-2' }, error: null },
    );

    const res = await POST(
      makeRequest({
        customers: [{ name: 'Juan Pérez' }, { name: 'María Gómez' }],
      }),
    );

    const events = await readNdjson(res);
    expect(events[0]).toMatchObject({ type: 'progress', processed: 0, total: 2 });
    expect(events.every((event) => event.type === 'progress' || event.type === 'done')).toBe(true);

    const progresses = events.filter((event) => event.type === 'progress');
    expect(progresses.map((event) => event.processed)).toEqual([0, 1, 2]);
    const done = doneEvent(events);
    expect(done.summary).toMatchObject({ created: 2, total: 2 });
    expect(events[events.length - 1].type).toBe('done');
  });

  it('devuelve 200 con skipped > 0 cuando una fila del medio falla', async () => {
    // existentes vacios, alta 1 ok, alta 2 caida: el fallo viaja como fila
    // skipped dentro del done, no como status (igual que el de productos).
    supabaseMock.__queue('customers', { data: [], error: null });
    supabaseMock.__queue(
      'customers',
      { data: { id: 'cust-1' }, error: null },
      { data: null, error: { message: 'deadlock detected' } },
    );

    const res = await POST(
      makeRequest({
        customers: [{ name: 'Juan Pérez' }, { name: 'María Gómez' }],
      }),
    );

    expect(res.status).toBe(200);
    const done = doneEvent(await readNdjson(res));
    expect(done.summary).toEqual({ created: 1, updated: 0, skipped: 1, total: 2 });
    expect(done.results).toHaveLength(2);
    expect((done.results as unknown[])[1]).toMatchObject({ row: 2, status: 'skipped' });
  });
});
