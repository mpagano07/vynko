import { AsyncLocalStorage } from 'node:async_hooks';
import { setLogContextProvider, type LogFields } from '@/lib/logger';

/**
 * Contexto de log por request.
 *
 * `logger` emite el JSON y `log-context` le pega el request id, el tenant y el
 * usuario sin que cada servicio tenga que recibirlos a mano: el contexto vive
 * en un AsyncLocalStorage que se entra una vez al autenticar y lo hereda todo
 * lo que se ejecute despues en ese request (servicios, RPCs, `after()`).
 *
 * El provider se registra al importar el modulo: cualquier archivo que use el
 * contexto tiene que importar algo de aca (hoy lo hace `api-auth.ts`, que pasa
 * por el camino de casi todas las rutas).
 */
const storage = new AsyncLocalStorage<LogFields>();

setLogContextProvider(() => storage.getStore());

/**
 * Pisa el contexto actual para el resto de la ejecucion async del request.
 *
 * Se usa `enterWith` y no `run` porque quien lo llama (el resolver de auth) no
 * puede envolver al caller: no controla el resto del handler.
 */
export function enterLogContext(context: LogFields): void {
  storage.enterWith({ ...storage.getStore(), ...context });
}

/** Envuelve una operacion completa con contexto propio (jobs, crons). */
export function withLogContext<T>(context: LogFields, run: () => T): T {
  return storage.run({ ...storage.getStore(), ...context }, run);
}

export function currentLogContext(): LogFields {
  return storage.getStore() ?? {};
}

/**
 * Id del request para poder cruzar un log con la invocacion de Vercel.
 *
 * Vercel inyecta `x-vercel-id`; localmente o en tests se genera uno.
 */
export function resolveRequestId(request?: Request): string {
  const header = request?.headers.get('x-request-id') ?? request?.headers.get('x-vercel-id');
  if (header) return header;
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}`;
}
