import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { authAsTenantA, callsTo } from '@/test/tenant-isolation';

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

vi.mock('@/lib/activity-log', () => ({ createActivityLog: vi.fn(async () => undefined) }));

import { adjustPrices } from '@/lib/product-service';
import { SUPABASE_MAX_ROWS } from '@/lib/supabase-paging';

/**
 * Bug real: ajustar precios por categoría con 1000+ productos fallaba con
 * "Ocurrio un error inesperado". La causa: adjustPrices traía TODOS los
 * product_id del tenant y filtraba `products` con `.in(id, [...])` — con 1000
 * IDs la URL del filtro llegaba a ~37KB y el gateway de Supabase la
 * rechazaba ("Bad Request"). Además cada update del loop arrastraba el mismo
 * `.in(...)` gigante en su URL, y el escaneo de product_stock chocaba contra
 * el tope silencioso de 1000 filas por SELECT.
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

    // La categoría llega como filtro eq sobre la misma query.
    const eqs = callsTo(supabaseMock.__calls, 'products', 'eq');
    expect(eqs.map((call) => call.args[0])).toContain('category_id');

    // Se aplica en UN solo upsert (las filas van en el body) con el precio
    // y el costo recalculados; costo null no se manda.
    const upserts = callsTo(supabaseMock.__calls, 'products', 'upsert');
    expect(upserts).toHaveLength(1);
    const [rows, options] = upserts[0].args as [Array<Record<string, unknown>>, { onConflict: string }];
    expect(rows).toEqual([
      { id: 'p-1', price_cents: 1100, updated_at: expect.any(String), cost: 550 },
      { id: 'p-2', price_cents: 1100, updated_at: expect.any(String) },
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

  it('un fallo del upsert queda en la lista de errores sin romper el resultado', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue(
      'products',
      { data: [productRow(1), productRow(2)], error: null },
      { data: null, error: { message: 'boom' } }
    );

    const result = await adjustPrices(authAsTenantA(), { percentage: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.updated).toBe(0);
    expect(result.data.errors).toHaveLength(2);
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
