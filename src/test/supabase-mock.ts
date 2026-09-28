import { vi } from 'vitest';

type Result = Record<string, unknown>;

interface Call {
  table: string;
  method: string;
  args: unknown[];
}

/**
 * Configurable chainable mock of the supabaseAdmin query builder.
 * Use `__queue(table, ...results)` to pre-program the responses each
 * query against that table will resolve to, in call order.
 */
function createSupabaseMock() {
  const queues = new Map<string, Result[]>();
  const calls: Call[] = [];

  function dequeue(table: string): Result {
    const q = queues.get(table);
    if (q && q.length > 0) return q.shift()!;
    return { data: null, error: null };
  }

  function createBuilder(table: string) {
    const builder: Record<string, unknown> = {};
    const chain =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };

    for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'lt', 'gt', 'order', 'range', 'is', 'limit', 'not', 'or', 'like', 'ilike']) {
      builder[method] = chain(method);
    }
    for (const method of ['insert', 'update', 'delete', 'upsert']) {
      builder[method] = chain(method);
    }
    builder.single = () => Promise.resolve(dequeue(table));
    builder.maybeSingle = () => Promise.resolve(dequeue(table));
    builder.then = (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(dequeue(table)).then(resolve, reject);

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
    __reset() {
      queues.clear();
      calls.length = 0;
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
