import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  claimDueJobs,
  computeBackoffMs,
  DEFAULT_MAX_ATTEMPTS,
  enqueueJob,
  listJobTypes,
  registerJobHandler,
  runDueJobs,
  type BackgroundJob,
} from './job-queue';
import { supabaseMock } from '@/test/supabase-mock';

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

function jobRow(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: 'job-1',
    job_type: 'demo',
    payload: {},
    tenant_id: null,
    status: 'running',
    run_after: new Date().toISOString(),
    attempts: 1,
    max_attempts: 5,
    locked_at: new Date().toISOString(),
    last_error: null,
    created_at: '2026-10-08T00:00:00Z',
    updated_at: '2026-10-08T00:00:00Z',
    ...overrides,
  };
}

function claim(...jobs: BackgroundJob[]) {
  supabaseMock.__rpcQueue('claim_background_jobs', { data: jobs, error: null });
}

function updates() {
  return supabaseMock.__calls.filter((c) => c.table === 'background_jobs' && c.method === 'update');
}

describe('job-queue', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('computeBackoffMs', () => {
    it('duplica en cada intento', () => {
      expect(computeBackoffMs(1)).toBe(30_000);
      expect(computeBackoffMs(2)).toBe(60_000);
      expect(computeBackoffMs(3)).toBe(120_000);
    });

    it('tiene techo para no dejar un trabajo esperando horas', () => {
      expect(computeBackoffMs(30)).toBe(30 * 60_000);
    });

    it('un intento invalido usa el primer escalon', () => {
      expect(computeBackoffMs(0)).toBe(30_000);
    });
  });

  describe('enqueueJob', () => {
    it('inserta el trabajo pendiente y devuelve su id', async () => {
      supabaseMock.__queue('background_jobs', { data: { id: 'job-9' }, error: null });

      const id = await enqueueJob({ jobType: 'demo', payload: { a: 1 }, tenantId: 'tenant-1' });

      expect(id).toBe('job-9');
      const insert = supabaseMock.__calls.find((c) => c.table === 'background_jobs' && c.method === 'insert');
      expect(insert?.args[0]).toMatchObject({
        job_type: 'demo',
        payload: { a: 1 },
        tenant_id: 'tenant-1',
        max_attempts: DEFAULT_MAX_ATTEMPTS,
      });
      expect(String((insert?.args[0] as { run_after: string }).run_after)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('acepta un run_after futuro', async () => {
      supabaseMock.__queue('background_jobs', { data: { id: 'job-10' }, error: null });

      await enqueueJob({ jobType: 'demo', runAfter: '2026-10-09T00:00:00.000Z' });

      const insert = supabaseMock.__calls.find((c) => c.method === 'insert');
      expect(insert?.args[0]).toMatchObject({ run_after: '2026-10-09T00:00:00.000Z' });
    });

    it('devuelve null si la base rechaza el insert', async () => {
      supabaseMock.__queue('background_jobs', { data: null, error: { message: 'boom' } });

      await expect(enqueueJob({ jobType: 'demo' })).resolves.toBeNull();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('claimDueJobs', () => {
    it('pasa el limite a la RPC y devuelve las filas', async () => {
      const job = jobRow();
      claim(job);

      await expect(claimDueJobs(3)).resolves.toEqual([job]);
      expect(supabaseMock.rpc).toHaveBeenCalledWith('claim_background_jobs', { p_limit: 3 });
    });

    it('lanza si la RPC falla: el cron tiene que responder 500', async () => {
      supabaseMock.__rpcQueue('claim_background_jobs', { data: null, error: { message: 'db caida' } });

      await expect(claimDueJobs()).rejects.toThrow('claim_background_jobs');
    });
  });

  describe('runDueJobs', () => {
    it('ejecuta el handler y marca la fila como succeeded', async () => {
      const handler = vi.fn();
      registerJobHandler('demo', handler);
      const job = jobRow();
      claim(job);

      const report = await runDueJobs();

      expect(report).toEqual({ claimed: 1, succeeded: 1, retried: 0, dead: 0 });
      expect(handler).toHaveBeenCalledWith(job);
      expect(updates()[0]?.args[0]).toMatchObject({ status: 'succeeded', locked_at: null, last_error: null });
      expect(listJobTypes()).toContain('demo');
    });

    it('si el handler falla, reprograma con backoff', async () => {
      registerJobHandler('demo', vi.fn().mockRejectedValue(new Error('mp caida')));
      const job = jobRow({ attempts: 1, max_attempts: 5 });
      claim(job);

      const report = await runDueJobs();

      expect(report).toEqual({ claimed: 1, succeeded: 0, retried: 1, dead: 0 });
      const update = updates()[0]?.args[0] as Record<string, unknown>;
      expect(update.status).toBe('pending');
      expect(update.locked_at).toBeNull();
      expect(update.last_error).toContain('mp caida');
      // 1er fallo: +30 s. Se compara contra el reloj real, por eso el margen.
      expect(new Date(String(update.run_after)).getTime()).toBeGreaterThan(Date.now() + 25_000);
    });

    it('cuando se agotan los intentos, queda dead con el error', async () => {
      registerJobHandler('demo', vi.fn().mockRejectedValue(new Error('siempre falla')));
      claim(jobRow({ attempts: 5, max_attempts: 5 }));

      const report = await runDueJobs();

      expect(report.dead).toBe(1);
      expect(updates()[0]?.args[0]).toMatchObject({ status: 'dead' });
      expect(console.error).toHaveBeenCalled();
    });

    it('un tipo sin handler muere en vez de reintentar para siempre', async () => {
      claim(jobRow({ job_type: 'nobody_home' }));

      const report = await runDueJobs();

      expect(report).toEqual({ claimed: 1, succeeded: 0, retried: 0, dead: 1 });
      expect(updates()[0]?.args[0]).toMatchObject({ status: 'dead' });
      const error = String((updates()[0]?.args[0] as { last_error: string }).last_error);
      expect(error).toContain('nobody_home');
    });

    it('sin trabajos no se toca ninguna fila', async () => {
      claim();

      const report = await runDueJobs();

      expect(report).toEqual({ claimed: 0, succeeded: 0, retried: 0, dead: 0 });
      expect(updates()).toHaveLength(0);
    });

    it('propaga el error del claim para que el cron falle en voz alta', async () => {
      supabaseMock.__rpcQueue('claim_background_jobs', { data: null, error: { message: 'db caida' } });

      await expect(runDueJobs()).rejects.toThrow('db caida');
    });
  });
});
