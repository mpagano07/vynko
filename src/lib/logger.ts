/**
 * Logger estructurado.
 *
 * Emite UNA linea JSON por evento: `{"level":"error","time":"...","msg":"...","error":{...}}`.
 * Vercel parsea lineas JSON de stdout y las indexa por nivel/campos, asi que un
 * `console.error('DB error:', err)` plano se vuelve buscable por tenant, por
 * codigo de Postgres o por stack sin tener que grepear texto libre.
 *
 * Es isomorfo a proposito: no importa `node:async_hooks` ni nada de servidor,
 * porque los componentes de cliente tambien pasan por aca. El contexto de
 * request (tenant, usuario, request id) lo inyecta `log-context.ts` a traves de
 * `setLogContextProvider`, que se registra una sola vez desde el lado servidor.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export type LogFields = Record<string, unknown>;

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/** Campos reservados: no se pueden pisar ni desde el contexto ni desde los fields. */
const RESERVED = new Set(['level', 'time', 'msg']);

type ContextProvider = () => LogFields | undefined;

let contextProvider: ContextProvider | undefined;

/**
 * Registra la fuente del contexto por request (AsyncLocalStorage en el server).
 *
 * Es un hook y no un import directo para que este archivo siga siendo
 * importable desde componentes de cliente sin arrastrar `node:async_hooks`.
 */
export function setLogContextProvider(provider: ContextProvider | undefined): void {
  contextProvider = provider;
}

function readLevel(): number {
  const raw = typeof process !== 'undefined' ? process.env?.LOG_LEVEL : undefined;
  const key = (raw ?? 'info').toLowerCase() as LogLevel;
  return LEVEL_VALUE[key] ?? LEVEL_VALUE.info;
}

export function isLogLevelEnabled(level: LogLevel): boolean {
  return LEVEL_VALUE[level] >= readLevel();
}

/**
 * Convierte cualquier valor en algo serializable.
 *
 * `JSON.stringify` sobre un Error tira todo: `message` y `stack` no son
 * enumerables, asi que `logger.error('x', { error: err })` dejaria el log casi
 * vacio. Los errores de Supabase ni siquiera son `Error`: son objetos planos
 * con `message`, `code`, `details` y `hint`.
 */
function toLogValue(value: unknown, seen: WeakSet<object>, depth = 0): unknown {
  if (value === null) return null;
  if (value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;

  if (typeof value === 'object') {
    if (depth > 8) return '[depth limit]';
    const obj = value as object;
    if (seen.has(obj)) return '[circular]';
    seen.add(obj);

    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
      const out: LogFields = { name: value.name, message: value.message };
      if (value.stack) out.stack = value.stack;
      for (const key of Object.keys(value)) {
        if (key in out) continue;
        out[key] = toLogValue((value as unknown as LogFields)[key], seen, depth + 1);
      }
      if (value.cause !== undefined && !('cause' in out)) {
        out.cause = toLogValue(value.cause, seen, depth + 1);
      }
      return out;
    }
    if (Array.isArray(value)) return value.map((v) => toLogValue(v, seen, depth + 1));

    const out: LogFields = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = RESERVED.has(key) ? String(val) : toLogValue(val, seen, depth + 1);
    }
    return out;
  }

  return String(value);
}

/**
 * `logger.error('DB error:', err)` -> msg `DB error`, campo `error`.
 * El dos puntos del mensaje final sobra: el detalle ya va en un campo con nombre.
 */
function normalize(args: unknown[]): { msg: string; fields: LogFields } {
  const [first, second, ...rest] = args;
  const fields: LogFields = {};

  let msg: string;
  if (typeof first === 'string') {
    msg = second === undefined ? first : first.replace(/:\s*$/, '');
  } else if (first instanceof Error) {
    msg = first.message;
    fields.error = first;
  } else {
    msg = String(first);
    fields.error = first;
  }

  if (second !== undefined) {
    if (second instanceof Error) {
      fields.error = second;
    } else if (typeof second === 'object' && second !== null && !Array.isArray(second)) {
      Object.assign(fields, second as LogFields);
    } else {
      fields.error = second;
    }
  }
  if (rest.length > 0) fields.extra = rest;

  return { msg, fields };
}

function emit(level: LogLevel, args: unknown[], bindings: LogFields): void {
  if (!isLogLevelEnabled(level)) return;

  const { msg, fields } = normalize(args);
  const context = contextProvider?.() ?? {};

  const record: LogFields = {};
  for (const source of [context, bindings, fields]) {
    for (const [key, value] of Object.entries(source)) {
      if (!RESERVED.has(key)) record[key] = toLogValue(value, new WeakSet());
    }
  }

  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg: toLogValue(msg, new WeakSet()),
    ...record,
  });

  // error/warn van a stderr: asi el nivel se refleja en los paneles de logs de
  // la plataforma y en los exit codes de los scripts.
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (level === 'debug') console.debug(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  debug(err: Error): void;
  info(msg: string, fields?: LogFields): void;
  info(err: Error): void;
  warn(msg: string, fields?: LogFields): void;
  warn(err: Error): void;
  error(msg: string, fields?: LogFields): void;
  error(err: Error): void;
  /** Logger con campos fijos (tenantId, requestId, modulo) en cada linea. */
  child(bindings: LogFields): Logger;
}

function createLogger(bindings: LogFields): Logger {
  const call =
    (level: LogLevel) =>
    (...args: unknown[]) =>
      emit(level, args, bindings);

  return {
    debug: call('debug') as Logger['debug'],
    info: call('info') as Logger['info'],
    warn: call('warn') as Logger['warn'],
    error: call('error') as Logger['error'],
    child: (extra: LogFields) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger: Logger = createLogger({});
