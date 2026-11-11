import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { authAsTenantA, callsTo } from '@/test/tenant-isolation';

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

vi.mock('@/lib/activity-log', () => ({ createActivityLog: vi.fn(async () => undefined) }));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { adjustPrices } from '@/lib/product-service';
import { logger } from '@/lib/logger';
import { SUPABASE_MAX_ROWS } from '@/lib/supabase-paging';

/**
 * Bug real (parte 1): ajustar precios por categoría con 1000+ productos fallaba
 * con "Ocurrio un error inesperado". La causa: adjustPrices traía TODOS los
 * product_id del tenant y filtraba `products` con `.in(id, [...])` — con 1000
 * IDs la URL del filtro llegaba a ~37KB y el gateway de Supabase la
 * rechazaba ("Bad Request"). Además cada update del loop arrastraba el mismo
 * `.in(...)` gigante en su URL, y el escaneo de product_stock chocaba contra
 * el tope silencioso de 1000 filas por SELECT.
 *
 * Bug real (parte 2): con el join arreglado, el ajuste corría pero quedaba en
 * "0 de 41 productos actualizados" con 41 errores silenciosos. El upsert de
 * PostgREST es un INSERT ... ON CONFLICT (id) DO UPDATE, y el INSERT construye
 * la fila con SOLO las columnas enviadas: `name` es NOT NULL sin default, así
 * que Postgres rechazaba cada tanda con 23502 antes de llegar al UPDATE. Por
 * eso las filas del upsert llevan `name` aunque no cambie.
 */

const productRow = (index: number, overrides: Record<string, unknown> = {}) => ({
  id: `p-${index}`,
  name: `Producto ${index}`,
  price_cents: 1000,
  cost: 500,
  category_id: 'cat-redes',
  stock_data: [{ product_id: `p-${index}` }],
  ...overrides,
});

beforeEach(() => {
  supabaseMock.__reset();
  vi.mocked(logger.error).mockClear();
});

describe('adjustPrices', () => {
  it('ajusta por categoría con el join por tenant, sin in() masivo de ids', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    // El select del join y el upsert consumen de la misma cola de 'products'.
    supabaseMock.__queue(
      'products',
      { data: [productRow(1), productRow(2, { cost: null })], error: null },
      { data: null, error: null } // resultado del upsert
    );

    const result = await adjustPrices(authAsTenantA(), { percentage: 10, category_id: 'cat-redes' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(2);
    expect(result.data.updated).toBe(2);

    // El alcance por tenant se resuelve con el join (como listProducts)...
    const inFilters = callsTo(supabaseMock.__calls, 'products', 'in').map((call) => call.args[0]);
    expect(inFilters).toContain('product_stock.tenant_id');
    // ...y nada de `.in(id, [todos los ids del tenant])` que revienta la URL.
    expect(inFilters).not.toContain('id');

    // La categoría llega como filtro eq sobre la misma query. Se filtra por
    // `product_stock.category_id` (migración 071): la global del producto
    // apunta a UNA categoría de UNA sucursal y dejaba fuera a los productos
    // recibidos por transferencia.
    const eqs = callsTo(supabaseMock.__calls, 'products', 'eq');
    expect(eqs.map((call) => call.args[0])).toContain('product_stock.category_id');

    // Se aplica en UN solo upsert (las filas van en el body) con el precio
    // y el costo recalculados; costo null no se manda. `name` va siempre:
    // es NOT NULL sin default y sin ella el INSERT del ON CONFLICT falla
    // con 23502 antes de llegar al UPDATE.
    const upserts = callsTo(supabaseMock.__calls, 'products', 'upsert');
    expect(upserts).toHaveLength(1);
    const [rows, options] = upserts[0].args as [Array<Record<string, unknown>>, { onConflict: string }];
    expect(rows).toEqual([
      { id: 'p-1', name: 'Producto 1', price_cents: 1100, updated_at: expect.any(String), cost: 550 },
      { id: 'p-2', name: 'Producto 2', price_cents: 1100, updated_at: expect.any(String) },
    ]);
    expect(options).toEqual({ onConflict: 'id' });
    // Ni un PATCH por producto.
    expect(callsTo(supabaseMock.__calls, 'products', 'update')).toHaveLength(0);
  });

  it('recorre el catálogo por rangos y aplica en tandas de 500', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    const page1 = Array.from({ length: SUPABASE_MAX_ROWS }, (_, i) => productRow(i));
    const page2 = Array.from({ length: 137 }, (_, i) => productRow(SUPABASE_MAX_ROWS + i));
    supabaseMock.__queue(
      'products',
      { data: page1, error: null },
      { data: page2, error: null },
      { data: null, error: null }, // upsert tanda 1
      { data: null, error: null }, // upsert tanda 2
      { data: null, error: null } // upsert tanda 3
    );

    const result = await adjustPrices(authAsTenantA(), { percentage: 5 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(SUPABASE_MAX_ROWS + 137);
    expect(result.data.updated).toBe(SUPABASE_MAX_ROWS + 137);

    // Paginó dos rangos: 0–999 y 1000–1999.
    const ranges = callsTo(supabaseMock.__calls, 'products', 'range').map((call) => call.args);
    expect(ranges).toEqual([
      [0, SUPABASE_MAX_ROWS - 1],
      [SUPABASE_MAX_ROWS, 2 * SUPABASE_MAX_ROWS - 1],
    ]);

    // Las 1137 filas van en 3 upserts: 500 + 500 + 137.
    const upserts = callsTo(supabaseMock.__calls, 'products', 'upsert');
    expect(upserts).toHaveLength(3);
    expect(upserts[0].args[0]).toHaveLength(500);
    expect(upserts[1].args[0]).toHaveLength(500);
    expect(upserts[2].args[0]).toHaveLength(137);
  });

  it('devuelve el error de la consulta sin tocar nada', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue('products', { data: null, error: { message: 'Bad Request', code: '413' } });

    const result = await adjustPrices(authAsTenantA(), { percentage: 10 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Ocurrio un error inesperado. Intenta de nuevo.');
    expect(result.status).toBe(500);
    expect(callsTo(supabaseMock.__calls, 'products', 'upsert')).toHaveLength(0);
  });

  it('un fallo del upsert queda en la lista de errores y se loguea, sin romper el resultado', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue(
      'products',
      { data: [productRow(1), productRow(2)], error: null },
      { data: null, error: { message: 'null value in column "name" violates not-null constraint', code: '23502' } }
    );

    const result = await adjustPrices(authAsTenantA(), { percentage: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.updated).toBe(0);
    expect(result.data.errors).toHaveLength(2);
    // El error real de PostgREST no puede quedar mudo: es lo que escondió
    // el "0 de 41 actualizados" hasta encontrar la causa.
    expect(logger.error).toHaveBeenCalled();
    const loggedCalls = vi.mocked(logger.error).mock.calls as unknown as Array<
      [string, Record<string, unknown>?]
    >;
    const logged = loggedCalls.find(([msg]) => msg === 'DB error:');
    expect(logged?.[1]).toMatchObject({ error: { code: '23502' } });
  });

  it('sin productos en el alcance responde 404', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue('products', { data: [], error: null });

    const result = await adjustPrices(authAsTenantA(), { percentage: 10, category_id: 'cat-vacia' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });
});
