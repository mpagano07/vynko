import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const runDueJobsMock = vi.fn();
const registerJobHandlersMock = vi.fn();

vi.mock('@/lib/job-queue', () => ({
  runDueJobs: (...args: unknown[]) => runDueJobsMock(...args),
}));

vi.mock('@/lib/job-handlers', () => ({
  registerJobHandlers: (...args: unknown[]) => registerJobHandlersMock(...args),
}));

const ORIGINAL_SECRET = process.env.CRON_SECRET;

const authorized = () =>
  new Request('http://localhost/api/cron/process-jobs', {
    headers: { authorization: 'Bearer test-secret' },
  });

const report = { claimed: 2, succeeded: 1, retried: 1, dead: 0 };

describe('GET /api/cron/process-jobs', () => {
  beforeEach(() => {
    runDueJobsMock.mockReset();
    runDueJobsMock.mockResolvedValue(report);
    registerJobHandlersMock.mockReset();
    process.env.CRON_SECRET = 'test-secret';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
    vi.restoreAllMocks();
  });

  it('drena la cola cuando el bearer token coincide', async () => {
    const res = await GET(authorized());

    expect(res.status).toBe(200);
    expect(registerJobHandlersMock).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual(report);
  });

  it('no es cacheable: el reporte tiene que ser el de esta corrida', async () => {
    const res = await GET(authorized());
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('rechaza sin autorizacion', async () => {
    const res = await GET(new Request('http://localhost/api/cron/process-jobs'));

    expect(res.status).toBe(401);
    expect(runDueJobsMock).not.toHaveBeenCalled();
  });

  it('rechaza un token equivocado', async () => {
    const res = await GET(
      new Request('http://localhost/api/cron/process-jobs', {
        headers: { authorization: 'Bearer wrong' },
      })
    );

    expect(res.status).toBe(401);
    expect(runDueJobsMock).not.toHaveBeenCalled();
  });

  it('si la cola no se pudo reclamar, responde 500 y no 200 con 0 trabajos', async () => {
    // Un 200 aca dejaria la cola parada sin que se note en el historial de
    // Vercel: la corrida se veria exitosa con "nada que hacer".
    runDueJobsMock.mockRejectedValue(new Error('db caida'));

    const res = await GET(authorized());

    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalled();
  });

  describe('sin CRON_SECRET configurado', () => {
    beforeEach(() => {
      delete process.env.CRON_SECRET;
    });

    it('queda deshabilitado en vez de abierto', async () => {
      // Fail closed: procesar la cola sin auth dejaria que cualquiera con la
      // anon key dispare trabajos.
      const res = await GET(authorized());

      expect(res.status).toBe(503);
      expect(runDueJobsMock).not.toHaveBeenCalled();
    });
  });
});

describe('POST /api/cron/process-jobs', () => {
  beforeEach(() => {
    runDueJobsMock.mockReset();
    runDueJobsMock.mockResolvedValue(report);
    registerJobHandlersMock.mockReset();
    process.env.CRON_SECRET = 'test-secret';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
    vi.restoreAllMocks();
  });

  it('se puede disparar a mano desde el runbook con la misma auth', async () => {
    const res = await POST(authorized());
    expect(res.status).toBe(200);
    expect(runDueJobsMock).toHaveBeenCalledTimes(1);
  });

  it('aplica la misma auth en POST', async () => {
    const res = await POST(new Request('http://localhost/api/cron/process-jobs'));
    expect(res.status).toBe(401);
    expect(runDueJobsMock).not.toHaveBeenCalled();
  });
});
