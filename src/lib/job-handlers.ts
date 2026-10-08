import { logger } from '@/lib/logger';
import { reconcileSubscriptions } from '@/lib/mercadopago-reconcile';
import { registerJobHandler } from '@/lib/job-queue';

let registered = false;

/**
 * Handlers disponibles para la cola (056). Se registran una sola vez por
 * proceso; el cron los llama desde `/api/cron/process-jobs`.
 *
 * Para sumar un trabajo: agregar aca `registerJobHandler('mi_trabajo', ...)`,
 * y encolarlo desde donde falle (o a mano con un `insert into background_jobs`).
 * Un tipo sin handler no reintenta: `runDueJobs` lo deja `dead` con el error
 * visible.
 */
export function registerJobHandlers(): void {
  if (registered) return;
  registered = true;

  /**
   * La reconciliacion de suscripciones corre todos los dias desde el cron de
   * Vercel (`17 5 * * *`) y ahi esta cubierta. Este handler existe para el
   * caso en el que esa corrida revienta: el cron la deja encolada con
   * `enqueueJob` y la cola reintenta con backoff en vez de esperar 24 horas.
   *
   * Que falle significa algo inesperado (la funcion ya atrapa los errores
   * transitorios de MP y los reporta como `unreachable`/`deferred`), asi que
   * reintentar es correcto: la reconciliacion es idempotente, en el peor caso
   * reutiliza `processMercadoPagoWebhook` y los compare-and-set no matchean.
   */
  registerJobHandler('reconcile_subscriptions', async () => {
    const report = await reconcileSubscriptions();
    logger.info('jobs: reconcile_subscriptions termino', {
      checked: report.checked,
      inSync: report.inSync,
      repaired: report.repaired,
      unreachable: report.unreachable,
    });
  });
}
