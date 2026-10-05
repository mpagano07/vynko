import { after } from 'next/server';

/**
 * Encola un trabajo para que corra DESPUES de responder.
 *
 * Se usa para trabajo que no debe decidir el resultado de la peticion: bitacoras,
 * analytics, auditoria. Ponerlo en el path critico hace que la venta espere por
 * el insert de un log, y peor: si el log falla, el error entra en el catch y
 * termina revirtiendo una venta que si se registro.
 *
 * Fuera de un scope de request (tests, scripts, jobs) `after` no existe. Ahi el
 * trabajo se dispara igual, pero nadie lo espera: es el unico comportamiento
 * razonable, porque no hay respuesta que proteger.
 */
export function scheduleAfterBackground(task: () => Promise<unknown> | unknown): void {
  try {
    after(async () => {
      try {
        await task();
      } catch (err) {
        // Un trabajo de fondo que falla no puede romper nada: ya se respondio.
        console.error('[after] background task failed:', err);
      }
    });
  } catch {
    // Sin contexto de request. Se dispara detached y se ignoran errores.
    void Promise.resolve()
      .then(task)
      .catch((err) => {
        console.error('[after] detached background task failed:', err);
      });
  }
}