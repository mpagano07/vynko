import type { AuthInfo } from '@/lib/api-auth';

/**
 * Utilidades para los tests cross-tenant (Empresa A -> Empresa B).
 *
 * La app habla con Supabase por `supabaseAdmin`, o sea el service role, que
 * corre con BYPASSRLS: las policies de RLS no protegen ni una sola de estas
 * queries. El unico aislamiento real es el `eq/in('tenant_id', ...)` que escribe
 * cada servicio. Estos helpers Dane los dos lados del ataque de forma explicita
 * para que un test falle cuando ese filtro falta.
 */

export const TENANT_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
export const TENANT_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

export const USER_A = '11111111-1111-4111-8111-111111111111';

/** Id de un recurso que pertenece a la Empresa B. */
export const FOREIGN_ID = '33333333-3333-4333-8333-333333333333';

/** Usuario de la Empresa A, miembro de esa empresa y de ninguna otra. */
export function authAsTenantA(overrides: Partial<AuthInfo> = {}): AuthInfo {
  return {
    tenantId: TENANT_A,
    userId: USER_A,
    allTenants: false,
    tenantIds: [TENANT_A],
    role: 'owner',
    ...overrides,
  };
}

interface RequestOptions {
  tenantId?: string;
  /** `__all__` activa el modo consolidado de los owners. */
  activeTenantId?: string;
}

/**
 * Request con los headers que `getAuth` necesita para no descartar la llamada:
 * mismo origen (si no, el chequeo CSRF la mata antes de llegar al servicio) y el
 * tenant activo.
 */
export function apiRequest(
  url: string,
  method: string,
  body?: unknown,
  options: RequestOptions = {}
): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    origin: 'http://localhost',
    host: 'localhost',
  });

  const activeTenantId = options.activeTenantId ?? options.tenantId ?? TENANT_A;
  if (activeTenantId) headers.set('x-active-tenant-id', activeTenantId);

  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** `{ params }` para los handlers `[id]` de App Router. */
export function routeParams(id: string): never {
  return { params: Promise.resolve({ id }) } as never;
}

/** `{ params }` para `products/barcode/[code]`. */
export function barcodeParams(code: string): never {
  return { params: Promise.resolve({ code }) } as never;
}

/**
 * Las llamadas que el codigo bajo prueba le hizo al query builder para una
 * tabla. Sirve para afirmar que una escritura NO se intento, que es la mitad de
 * los casos donde el filtro de tenant tiene que estar.
 */
export function callsTo(
  calls: ReadonlyArray<{ table: string; method: string; args: unknown[] }>,
  table: string,
  method?: string
) {
  return calls.filter((call) => call.table === table && (!method || call.method === method));
}

/** Las escrituras intentadas sobre una tabla. */
export function writesTo(
  calls: ReadonlyArray<{ table: string; method: string; args: unknown[] }>,
  table: string
) {
  return calls.filter(
    (call) =>
      call.table === table && ['insert', 'update', 'upsert', 'delete'].includes(call.method)
  );
}
