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
  return new Request('http://localhost/api/suppliers/import', {
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

describe('POST /api/suppliers/import', () => {
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

    const res = await POST(makeRequest({ suppliers: [{ name: 'Distribuidora SA' }] }));

    expect(res.status).toBe(503);
    expect(guardKillMock).toHaveBeenCalledWith('imports');
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('devuelve 401 sin sesion', async () => {
    vi.mocked(getAuth).mockResolvedValue(null);
    const res = await POST(makeRequest({ suppliers: [{ name: 'Distribuidora SA' }] }));
    expect(res.status).toBe(401);
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('devuelve 403 para un member: gestionar proveedores es escritura de gestion', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
    const res = await POST(makeRequest({ suppliers: [{ name: 'Distribuidora SA' }] }));
    expect(res.status).toBe(403);
    expect(
      supabaseMock.__calls.filter((c) => c.table === 'suppliers' && c.method === 'insert'),
    ).toHaveLength(0);
  });

  it('devuelve 400 si no viene ninguna lista de proveedores', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No rows provided' });
  });

  it('devuelve 400 con la lista vacia', async () => {
    const res = await POST(makeRequest({ suppliers: [] }));
    expect(res.status).toBe(400);
  });

  it('responde con el reporte y mantiene el espejo providers', async () => {
    // Rol de gestor, lectura de existentes vacia, alta con id y espejo.
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue('suppliers', { data: [], error: null });
    supabaseMock.__queue('suppliers', { data: { id: 'sup-1' }, error: null });

    const res = await POST(
      makeRequest({
        suppliers: [{ name: 'Distribuidora SA', email: 'ventas@dist.com' }, { name: '' }],
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

    const mirror = supabaseMock.__calls.filter((c) => c.table === 'providers' && c.method === 'insert');
    expect(mirror).toHaveLength(1);
    expect(mirror[0].args[0]).toMatchObject({ id: 'sup-1', tenant_id: 'tenant-1', name: 'Distribuidora SA' });
  });

  it('streamea el progreso fila por fila y termina con el evento done', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue('suppliers', { data: [], error: null });
    supabaseMock.__queue(
      'suppliers',
      { data: { id: 'sup-1' }, error: null },
      { data: { id: 'sup-2' }, error: null },
    );

    const res = await POST(
      makeRequest({
        suppliers: [{ name: 'Distribuidora SA' }, { name: 'Almacén Central' }],
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
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue('suppliers', { data: [], error: null });
    supabaseMock.__queue(
      'suppliers',
      { data: { id: 'sup-1' }, error: null },
      { data: null, error: { message: 'deadlock detected' } },
    );

    const res = await POST(
      makeRequest({
        suppliers: [{ name: 'Distribuidora SA' }, { name: 'Almacén Central' }],
      }),
    );

    expect(res.status).toBe(200);
    const done = doneEvent(await readNdjson(res));
    expect(done.summary).toEqual({ created: 1, updated: 0, skipped: 1, total: 2 });
    expect(done.results).toHaveLength(2);
    expect((done.results as unknown[])[1]).toMatchObject({ row: 2, status: 'skipped' });
  });
});
