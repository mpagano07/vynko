import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { logger } from '@/lib/logger';

/**
 * Cola de trabajos de fondo con reintentos (migracion 056).
 *
 * Es la variante serverless: no hay proceso worker ni libreria de cola, la
 * cola es la tabla `background_jobs` y la gorra es el cron
 * `GET|POST /api/cron/process-jobs`, que reclama trabajos vencidos con
 * `claim_background_jobs` (atomico, `SKIP LOCKED`), ejecuta el handler
 * registrado y escribe el resultado.
 *
 * Ciclo de vida:
 *
 *   pending --> running --> succeeded
 *                |  ^
 *                |  +-- vuelve a pending con `run_after` en el futuro (backoff)
 *                +----> dead (se agotaron los intentos, o tipo sin handler)
 *
 * El reintento NO depende de que alguien lo pida: si el handler lanza, la fila
 * vuelve a `pending` con backoff exponencial (30 s, 60 s, 120 s... tope
 * 30 min) hasta `max_attempts`. Si la instancia muere con el trabajo tomado,
 * `claim_background_jobs` recupera los locks vencidos en la proxima pasada.
 */

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'dead';

export interface BackgroundJob {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  tenant_id: string | null;
  status: JobStatus;
  run_after: string;
  attempts: number;
  max_attempts: number;
  locked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export type JobHandler = (job: BackgroundJob) => Promise<void>;

export const DEFAULT_MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 30 * 60_000;
const MAX_ERROR_LENGTH = 500;

const handlers = new Map<string, JobHandler>();

/**
 * Registra el handler de un tipo de trabajo. El registro es modulo-por-modulo
 * (`src/lib/job-handlers.ts` lo hace al importarse) para que el cron pueda
 * despachar sin que cada ruta tenga que conocer todos los handlers.
 */
export function registerJobHandler(jobType: string, handler: JobHandler): void {
  handlers.set(jobType, handler);
}

export function listJobTypes(): string[] {
  return [...handlers.keys()];
}

/**
 * Backoff exponencial con techo. `attempts` viene ya incrementado por el
 * claim: el primer fallo (attempts = 1) reprograma a los 30 s, el segundo a
 * los 60 s, y asi. Deterministico a proposito: los tests y el runbook pueden
 * calcular la proxima corrida sin ejecutar nada.
 */
export function computeBackoffMs(attempts: number): number {
  const exponent = Math.min(Math.max(attempts, 1) - 1, 20);
  return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS);
}

export interface EnqueueJobOptions {
  jobType: string;
  payload?: Record<string, unknown>;
  tenantId?: string | null;
  /** Cuando puede ser reclamado. Default: ya. */
  runAfter?: string | Date;
  maxAttempts?: number;
}

/**
 * Deja un trabajo en la cola. Devuelve el id, o `null` si no se pudo encolar.
 * Nunca lanza: encolar es siempre mejor esfuerzo y los llamadores estan en un
 * camino de fallo (un cron que acaba de reventar). Que falle tambien la cola
 * no cambia nada: se loguea y se sigue.
 */
export async function enqueueJob(options: EnqueueJobOptions): Promise<string | null> {
  const { jobType, payload = {}, tenantId = null, runAfter, maxAttempts = DEFAULT_MAX_ATTEMPTS } = options;

  try {
    const runAfterIso =
      runAfter === undefined
        ? new Date().toISOString()
        : typeof runAfter === 'string'
          ? runAfter
          : runAfter.toISOString();

    const { data, error } = await supabaseAdmin
      .from('background_jobs')
      .insert({
        job_type: jobType,
        payload,
        tenant_id: tenantId,
        run_after: runAfterIso,
        max_attempts: maxAttempts,
      })
      .select('id')
      .single();

    if (error || !data) {
      logger.error('jobs: no se pudo encolar', { jobType, error });
      return null;
    }

    return data.id as string;
  } catch (error) {
    logger.error('jobs: no se pudo encolar', { jobType, error });
    return null;
  }
}

/**
 * Reclama trabajos vencidos. Lanza si la base no esta disponible: en ese caso
 * el cron tiene que responder 500 para que Vercel marque la corrida como
 * fallida y se vea, en vez de reportar "0 trabajos" como si todo hubiera ido
 * bien.
 */
export async function claimDueJobs(limit = 10): Promise<BackgroundJob[]> {
  const { data, error } = await supabaseAdmin.rpc('claim_background_jobs', { p_limit: limit });

  if (error) {
    throw new Error(`claim_background_jobs: ${error.message}`);
  }

  return (data ?? []) as BackgroundJob[];
}

async function markDead(job: BackgroundJob, reason: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('background_jobs')
    .update({
      status: 'dead',
      locked_at: null,
      last_error: reason.slice(0, MAX_ERROR_LENGTH),
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  if (error) {
    // La fila queda `running` y el lock vence solo en 15 min; no se pierde el
    // trabajo, se atrasa.
    logger.error('jobs: no se pudo marcar como dead', { jobType: job.job_type, jobId: job.id, error });
  }

  logger.error('jobs: sin reintentos disponibles, queda dead', {
    jobType: job.job_type,
    jobId: job.id,
    attempts: job.attempts,
    reason,
  });
}

async function failJob(job: BackgroundJob, reason: string): Promise<void> {
  if (job.attempts >= job.max_attempts) {
    await markDead(job, reason);
    return;
  }

  const runAfter = new Date(Date.now() + computeBackoffMs(job.attempts)).toISOString();
  const { error } = await supabaseAdmin
    .from('background_jobs')
    .update({
      status: 'pending',
      locked_at: null,
      last_error: reason.slice(0, MAX_ERROR_LENGTH),
      run_after: runAfter,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  if (error) {
    logger.error('jobs: no se pudo reprogramar', { jobType: job.job_type, jobId: job.id, error });
  }
}

async function completeJob(job: BackgroundJob): Promise<void> {
  const { error } = await supabaseAdmin
    .from('background_jobs')
    .update({
      status: 'succeeded',
      locked_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  if (error) {
    logger.error('jobs: no se pudo marcar como succeeded', { jobType: job.job_type, jobId: job.id, error });
  }
}

export interface JobsRunReport {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
}

/**
 * Ejecuta de a uno los trabajos vencidos. Secuencial a proposito: la gorra es
 * un cron con un timeout, y un trabajo que tarda no debe dejar corridas
 * solapadas del mismo tipo (dos reconciliaciones a la vez se peleian por los
 * mismos compare-and-set).
 */
export async function runDueJobs(options: { limit?: number } = {}): Promise<JobsRunReport> {
  const jobs = await claimDueJobs(options.limit ?? 10);
  const report: JobsRunReport = { claimed: jobs.length, succeeded: 0, retried: 0, dead: 0 };

  for (const job of jobs) {
    const handler = handlers.get(job.job_type);

    if (!handler) {
      // Sin handler el trabajo nunca va a poder correr: reintentarlo solo
      // consume la cola. Muere con el error visible para que el runbook lo vea.
      await markDead(job, `sin handler registrado para el tipo "${job.job_type}"`);
      report.dead += 1;
      continue;
    }

    try {
      await handler(job);
      await completeJob(job);
      report.succeeded += 1;
      logger.info('jobs: termino', { jobType: job.job_type, jobId: job.id, attempts: job.attempts });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await failJob(job, reason);
      if (job.attempts >= job.max_attempts) report.dead += 1;
      else report.retried += 1;
      logger.error('jobs: fallo', {
        jobType: job.job_type,
        jobId: job.id,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        error,
      });
    }
  }

  return report;
}
