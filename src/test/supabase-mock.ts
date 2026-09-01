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

    for (const method of ['select', 'eq', 'in', 'gte', 'order', 'range', 'is', 'limit', 'not', 'or', 'like', 'ilike']) {
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

  return {
    from: (table: string) => createBuilder(table),
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
      vi.clearAllMocks();
    },
    get __calls() {
      return calls;
    },
  };
}

export type SupabaseMock = ReturnType<typeof createSupabaseMock>;

export const supabaseMock = createSupabaseMock();
