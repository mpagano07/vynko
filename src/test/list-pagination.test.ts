import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgrestError } from '@supabase/supabase-js';
import { supabaseMock } from '@/test/supabase-mock';
import { authAsTenantA, callsTo } from '@/test/tenant-isolation';

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

import { listCustomers } from '@/lib/customer-service';
import { listProducts } from '@/lib/product-service';
import { listSuppliers } from '@/lib/supplier-service';
import { SUPABASE_MAX_ROWS, selectAllRows, type SelectAllPage } from '@/lib/supabase-paging';

/**
 * PostgREST corta todo SELECT en `db-max-rows` (1000 en Supabase) sin error ni
 * aviso. El bug real: tras importar 1000 artículos sobre un catálogo que ya
 * tenía productos, /products mostraba "1000" pero el resto nunca llegaba al
 * navegador y el filtro no podía encontrarlo. Estos tests fijan que los
 * listados recorren la tabla por rangos hasta agotarla.
 */

const productRows = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => ({
    id: `p-${offset + i}`,
    name: `Producto ${offset + i}`,
    price_cents: 1000,
    stock_data: [
      { stock: offset + i, min_stock: 0, max_stock: 10, deposito: null, pasillo: null, estanteria: null },
    ],
  }));

const partyRows = (prefix: string, count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${offset + i}`,
    name: `Registro ${offset + i}`,
    tenant_id: authAsTenantA().tenantId,
  }));

beforeEach(() => {
  supabaseMock.__reset();
});

describe('selectAllRows', () => {
  it('concatena páginas hasta que llega una corta', async () => {
    const pages: SelectAllPage<Record<string, unknown>>[] = [
      { data: Array.from({ length: SUPABASE_MAX_ROWS }, (_, i) => ({ i })), error: null },
      { data: [{ i: 'ultima' }, { i: 'fila' }], error: null },
    ];
    const buildPage = vi.fn(
      (from: number): Promise<SelectAllPage<Record<string, unknown>>> =>
        Promise.resolve(pages[from / SUPABASE_MAX_ROWS])
    );

    const { data, error } = await selectAllRows(buildPage);

    expect(error).toBeNull();
    expect(data).toHaveLength(SUPABASE_MAX_ROWS + 2);
    expect(data[data.length - 1]).toEqual({ i: 'fila' });
    expect(buildPage).toHaveBeenNthCalledWith(1, 0, SUPABASE_MAX_ROWS - 1);
    expect(buildPage).toHaveBeenNthCalledWith(2, SUPABASE_MAX_ROWS, 2 * SUPABASE_MAX_ROWS - 1);
    expect(buildPage).toHaveBeenCalledTimes(2);
  });

  it('hace una sola pasada cuando la primera página viene corta', async () => {
    const buildPage = vi.fn(
      async (): Promise<SelectAllPage<Record<string, unknown>>> => ({ data: [{ i: 1 }, { i: 2 }], error: null })
    );

    const { data, error } = await selectAllRows(buildPage);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(buildPage).toHaveBeenCalledTimes(1);
  });

  it('corta en el primer error y lo devuelve', async () => {
    const dbError = new PostgrestError({ message: 'boom', details: '', hint: '', code: 'PGRST123' });
    const buildPage = vi.fn(
      async (): Promise<SelectAllPage<Record<string, unknown>>> => ({ data: null, error: dbError })
    );

    const { data, error } = await selectAllRows(buildPage);

    expect(error).toBe(dbError);
    expect(data).toEqual([]);
  });
});

describe('listProducts con catálogo más grande que el tope de PostgREST', () => {
  it('recorre el catálogo por rangos y devuelve TODOS los productos', async () => {
    supabaseMock.__queue(
      'products',
      { data: productRows(SUPABASE_MAX_ROWS), error: null },
      { data: productRows(137, SUPABASE_MAX_ROWS), error: null }
    );

    const result = await listProducts(authAsTenantA());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.products).toHaveLength(SUPABASE_MAX_ROWS + 137);
    // El mapeo (stock embebido -> columna plana) también aplica a las filas
    // que vienen en la segunda página, más allá del tope de 1000.
    expect(result.products[SUPABASE_MAX_ROWS + 136]).toMatchObject({
      id: `p-${SUPABASE_MAX_ROWS + 136}`,
      stock: SUPABASE_MAX_ROWS + 136,
    });

    // Paginó dos rangos: 0–999 y 1000–1999.
    const ranges = callsTo(supabaseMock.__calls, 'products', 'range').map((call) => call.args);
    expect(ranges).toEqual([
      [0, SUPABASE_MAX_ROWS - 1],
      [SUPABASE_MAX_ROWS, 2 * SUPABASE_MAX_ROWS - 1],
    ]);

    // Cada página se construye con el orden determinístico (created_at desc +
    // id como tiebreak): sin él, los rangos pueden solaparse o dejar filas.
    const orders = callsTo(supabaseMock.__calls, 'products', 'order');
    expect(orders[0].args).toEqual(['created_at', { ascending: false, nullsFirst: false }]);
    expect(orders[1].args).toEqual(['id', { ascending: true }]);
  });

  it('no hace una segunda pasada si el catálogo entra en la primera página', async () => {
    supabaseMock.__queue('products', { data: productRows(12), error: null });

    const result = await listProducts(authAsTenantA());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.products).toHaveLength(12);
    expect(callsTo(supabaseMock.__calls, 'products', 'range')).toHaveLength(1);
  });
});

describe('listCustomers con más de 1000 clientes', () => {
  it('recorre por rangos y devuelve todos los clientes', async () => {
    supabaseMock.__queue(
      'customers',
      { data: partyRows('c', SUPABASE_MAX_ROWS), error: null },
      { data: partyRows('c', 45, SUPABASE_MAX_ROWS), error: null }
    );

    const result = await listCustomers(authAsTenantA());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(SUPABASE_MAX_ROWS + 45);

    const ranges = callsTo(supabaseMock.__calls, 'customers', 'range').map((call) => call.args);
    expect(ranges).toEqual([
      [0, SUPABASE_MAX_ROWS - 1],
      [SUPABASE_MAX_ROWS, 2 * SUPABASE_MAX_ROWS - 1],
    ]);
  });
});

describe('listSuppliers con más de 1000 proveedores', () => {
  it('recorre por rangos y devuelve todos los proveedores', async () => {
    supabaseMock.__queue(
      'suppliers',
      { data: partyRows('s', SUPABASE_MAX_ROWS), error: null },
      { data: partyRows('s', 45, SUPABASE_MAX_ROWS), error: null }
    );

    const result = await listSuppliers(authAsTenantA());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(SUPABASE_MAX_ROWS + 45);

    const ranges = callsTo(supabaseMock.__calls, 'suppliers', 'range').map((call) => call.args);
    expect(ranges).toEqual([
      [0, SUPABASE_MAX_ROWS - 1],
      [SUPABASE_MAX_ROWS, 2 * SUPABASE_MAX_ROWS - 1],
    ]);
  });
});
