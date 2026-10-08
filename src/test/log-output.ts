import { vi } from 'vitest';

/**
 * Lee las lineas JSON que emite `@/lib/logger` desde un spy de console.
 *
 * El logger escribe UNA linea por evento, asi que parsear la ultima llamada
 * da el registro completo (nivel, msg, campos) en vez de hacer asserts sobre
 * texto libre, que es justamente lo que el logger estructurado deja de producir.
 */
export type LogRecord = Record<string, unknown> & { level: string; msg: string };

export function readLogs(spy: { mock: { calls: unknown[][] } }): LogRecord[] {
  return spy.mock.calls
    .map((call) => call[0])
    .filter((arg): arg is string => typeof arg === 'string')
    .map((line) => JSON.parse(line) as LogRecord);
}

export function findLog(spy: { mock: { calls: unknown[][] } }, msg: string): LogRecord | undefined {
  return readLogs(spy).find((record) => record.msg === msg);
}

export type ConsoleSpy = ReturnType<typeof vi.spyOn>;
