import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@/lib/api-auth';
import { supabaseMock } from '@/test/supabase-mock';
import { POST } from './route';

const mockAuth = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  allTenants: false,
  tenantIds: ['tenant-1'],
};

vi.mock('@/lib/api-auth', () => ({ getAuth: vi.fn(async () => mockAuth) }));
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));
vi.mock('@/lib/activity-log', () => ({ createActivityLog: vi.fn(async () => undefined) }));
vi.mock('@/lib/track-event', () => ({ trackEvent: vi.fn(async () => undefined) }));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/products/import', {
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

describe('POST /api/products/import', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getAuth).mockResolvedValue(mockAuth);
  });

  it('devuelve 401 sin sesion', async () => {
    vi.mocked(getAuth).mockResolvedValue(null);
    const res = await POST(makeRequest({ products: [{ name: 'Coca' }] }));
    expect(res.status).toBe(401);
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('devuelve 403 para un member (el catalogo global es escritura de gestion)', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
    const res = await POST(makeRequest({ products: [{ name: 'Coca' }] }));
    expect(res.status).toBe(403);
    expect(
      supabaseMock.__calls.filter((c) => c.table === 'products' && c.method === 'insert'),
    ).toHaveLength(0);
  });

  it('devuelve 400 si no viene ninguna lista de productos', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No products provided' });
  });

  it('devuelve 400 con la lista vacia', async () => {
    const res = await POST(makeRequest({ products: [] }));
    expect(res.status).toBe(400);
  });

  it('responde con el reporte fila por fila y el resumen', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' }, error: null });
    // Fila 1: busca SKU -> vacio, inserta -> ok. Fila 2: sin nombre -> se omite.
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    const res = await POST(
      makeRequest({
        products: [{ name: 'Coca Cola', sku: 'COC-500', price: 1500, stock: 10 }, { name: '' }],
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
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' }, error: null });
    supabaseMock.__queue(
      'products',
      { data: null, error: null },
      { data: { id: 'prod-1' }, error: null },
      { data: { id: 'prod-2' }, error: null },
    );

    const res = await POST(
      makeRequest({
        products: [
          { name: 'Producto 1', sku: 'SKU-1' },
          { name: 'Producto 2', sku: 'SKU-2' },
        ],
      }),
    );

    const events = await readNdjson(res);
    // El primer evento ya trae el total: la barra puede dibujarse antes de que
    // la primera fila termine de escribirse.
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
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' }, error: null });
    // products: [lookup vacio, lote caido, reintento fila 1 ok, reintento fila 2 ko]
    supabaseMock.__queue(
      'products',
      { data: null, error: null },
      { data: null, error: { message: 'deadlock detected' } },
      { data: null, error: null },
      { data: null, error: { message: 'deadlock detected' } },
    );

    const res = await POST(
      makeRequest({
        products: [
          { name: 'Producto 1', sku: 'SKU-1' },
          { name: 'Producto 2', sku: 'SKU-2' },
        ],
      }),
    );

    // La API no puede responder 500: la fila 1 ya quedo escrita y el cliente
    // necesita el reporte para saber exactamente cual fallo. Por eso el fallo
    // viaja como una fila skipped dentro del evento done, no como status.
    expect(res.status).toBe(200);
    const done = doneEvent(await readNdjson(res));
    expect(done.summary).toEqual({ created: 1, updated: 0, skipped: 1, total: 2 });
    expect(done.results).toHaveLength(2);
    expect((done.results as unknown[])[1]).toMatchObject({ row: 2, status: 'skipped' });
  });
});
