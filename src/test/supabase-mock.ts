import { vi } from 'vitest';

type Result = Record<string, unknown>;

interface Call {
  table: string;
  method: string;
  args: unknown[];
}

interface Predicate {
  column: string;
  values: unknown[];
  kind: 'eq' | 'in' | 'is';
}

/**
 * Aplica los predicados que el codigo bajo prueba le paso al query builder,
 * para que el mock se comporte como Postgres/PostgREST.
 *
 * Solo se usa cuando el mock esta en modo tenant-aware (`__setTenantAware`),
 * que es lo que permite escribir tests cross-tenant reales: se encola una fila
 * que pertenece a la Empresa B y el servicio de la Empresa A solo la recibe si
 * NO filtro por `tenant_id`. Un filtro ausente se convierte en un test rojo.
 *
 * Las columnas ausentes en la fila se dejan pasar a proposito: las filas de
 * tablas globales (`products`, que no tiene `tenant_id`) y los objetos de un
 * join embebido no traen la columna, y filtrarlos seria inventar un bug.
 */
function applyPredicates(data: unknown, predicates: Predicate[]): unknown {
  if (predicates.length === 0) return data;

  const matches = (row: unknown): boolean => {
    if (typeof row !== 'object' || row === null) return true;
    const record = row as Record<string, unknown>;

    return predicates.every((predicate) => {
      const value = record[predicate.column];
      if (value === undefined) return true;
      if (predicate.kind === 'is') return value === null;
      return predicate.values.some((candidate) => String(candidate) === String(value));
    });
  };

  if (Array.isArray(data)) return data.filter(matches);
  return matches(data) ? data : null;
}

const FILTERABLE_VERBS = new Set(['select', 'update', 'delete']);

/**
 * Configurable chainable mock of the supabaseAdmin query builder.
 * Use `__queue(table, ...results)` to pre-program the responses each
 * query against that table will resolve to, in call order.
 */
function createSupabaseMock() {
  const queues = new Map<string, Result[]>();
  const calls: Call[] = [];
  let tenantAware = false;

  function dequeue(table: string): Result {
    const q = queues.get(table);
    if (q && q.length > 0) return q.shift()!;
    return { data: null, error: null };
  }

  function createBuilder(table: string) {
    const builder: Record<string, unknown> = {};
    const predicates: Predicate[] = [];
    let verb: string | null = null;

    const chain =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args });
        if (verb === null) verb = method;
        if (method === 'eq') predicates.push({ column: String(args[0]), values: [args[1]], kind: 'eq' });
        if (method === 'in') predicates.push({ column: String(args[0]), values: (args[1] as unknown[]) ?? [], kind: 'in' });
        if (method === 'is') predicates.push({ column: String(args[0]), values: [], kind: 'is' });
        return builder;
      };

    for (const method of ['select', 'eq', 'neq', 'in', 'gte', 'lte', 'lt', 'gt', 'order', 'range', 'is', 'limit', 'not', 'or', 'like', 'ilike']) {
      builder[method] = chain(method);
    }
    for (const method of ['insert', 'update', 'delete', 'upsert']) {
      builder[method] = chain(method);
    }

    function resolve(mode: 'single' | 'maybeSingle' | 'then'): Result {
      const raw = dequeue(table);
      if (!tenantAware || !verb || !FILTERABLE_VERBS.has(verb)) return raw;

      const filtered = applyPredicates(raw.data, predicates);
      const isEmpty = Array.isArray(filtered) ? filtered.length === 0 : filtered === null;

      if (isEmpty) {
        // `single()` sobre cero filas es un error en PostgREST; `maybeSingle()`
        // devuelve null sin error. El codigo de produccion depende de esa
        // diferencia para decidir entre 404 y "no encontrado".
        return mode === 'single'
          ? { data: null, error: { message: 'mock: single() sin filas tras filtrar', code: 'PGRST116' } }
          : { data: null, error: null };
      }
      return { data: filtered, error: raw.error ?? null };
    }

    builder.single = () => Promise.resolve(resolve('single'));
    builder.maybeSingle = () => Promise.resolve(resolve('maybeSingle'));
    builder.then = (resolveFn: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(resolve('then')).then(resolveFn, reject);

    return builder as Record<string, (...args: unknown[]) => unknown> & {
      single: () => Promise<Result>;
      maybeSingle: () => Promise<Result>;
      then: (a: (v: Result) => unknown, b: (e: unknown) => unknown) => Promise<unknown>;
    };
  }

  const storageCalls: { method: string; args: unknown[] }[] = [];
  const storageResults = {
    upload: { error: null as unknown },
    createSignedUrl: { data: { signedUrl: 'https://signed.example/image.png' } as unknown, error: null as unknown },
    createSignedUrls: { data: [] as unknown, error: null as unknown },
    remove: { error: null as unknown },
  };

  // `rate_limit_hit` es la unica funcion que la app llama por RPC. El mock
  // devuelve la ventana abierta: la suite ya fija `RATE_LIMIT_STORE=memory` en
  // `vitest.setup.ts` para poder afirmar los 429, pero si un test alcanza esta
  // ruta sin `rpc` explotaria con "rpc is not a function", que no dice nada del
  // bug real.
  const rpcResults: Record<string, unknown> = {
    rate_limit_hit: { data: [{ ok: true, retry_after_seconds: 0 }], error: null },
  };

  const rpc = vi.fn(async (fn: string) => {
    const result = rpcResults[fn];
    if (result === undefined) {
      return { data: null, error: { message: `mock: la funcion ${fn} no esta mockeada` } };
    }
    return result;
  });

  const storageBucket = {
    upload: vi.fn(async (...args: unknown[]) => {
      storageCalls.push({ method: 'upload', args });
      return { error: storageResults.upload.error };
    }),
    createSignedUrl: vi.fn(async (...args: unknown[]) => {
      storageCalls.push({ method: 'createSignedUrl', args });
      return storageResults.createSignedUrl;
    }),
    createSignedUrls: vi.fn(async (...args: unknown[]) => {
      storageCalls.push({ method: 'createSignedUrls', args });
      return storageResults.createSignedUrls;
    }),
    remove: vi.fn(async (...args: unknown[]) => {
      storageCalls.push({ method: 'remove', args });
      return { error: storageResults.remove.error };
    }),
  };

  return {
    from: (table: string) => createBuilder(table),
    rpc,
    storage: {
      from: vi.fn(() => storageBucket),
    },
    __storage: storageBucket,
    __storageCalls: storageCalls,
    __storageResults: storageResults,
    __rpcResults: rpcResults,
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: null as null | Record<string, unknown> },
        error: null as null | Record<string, unknown>,
      })),
      admin: {
        inviteUserByEmail: vi.fn(async () => ({ data: { user: {} }, error: null })),
      },
    },
    __queue(table: string, ...results: Result[]) {
      const existing = queues.get(table) ?? [];
      queues.set(table, [...existing, ...results]);
    },
    /**
     * Enciende el filtro por `tenant_id` (y el resto de predicados eq/in/is).
     * Apagado por defecto para no cambiar el comportamiento de las suites
     * existentes, que encolan filas sin `tenant_id`.
     */
    __setTenantAware(value: boolean) {
      tenantAware = value;
    },
    __reset() {
      queues.clear();
      calls.length = 0;
      tenantAware = false;
      storageCalls.length = 0;
      storageResults.upload.error = null;
      storageResults.createSignedUrl = { data: { signedUrl: 'https://signed.example/image.png' }, error: null };
      storageResults.createSignedUrls = { data: [], error: null };
      storageResults.remove.error = null;
      rpcResults.rate_limit_hit = { data: [{ ok: true, retry_after_seconds: 0 }], error: null };
      vi.clearAllMocks();
    },
    get __calls() {
      return calls;
    },
  };
}

export type SupabaseMock = ReturnType<typeof createSupabaseMock>;

export const supabaseMock = createSupabaseMock();
