import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { TENANT_A, TENANT_B, authAsTenantA, callsTo } from '@/test/tenant-isolation';

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

import { lookupProductByCode } from '@/lib/product-service';

const BARCODE = '7791000000021';

function product(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Producto ${id}`,
    barcode: BARCODE,
    price_cents: 150000,
    ...overrides,
  };
}

beforeEach(() => {
  supabaseMock.__reset();
  supabaseMock.__setTenantAware(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('lookupProductByCode', () => {
  it('resuelve un codigo repetido en varias empresas usando el stock de la empresa activa', async () => {
    // Caso real: la migracion 016 quito el UNIQUE de `barcode` y cada empresa
    // tiene su propia fila del mismo producto. `maybeSingle()` fallaba con
    // PGRST116 y el escaner mostraba "Error al buscar producto".
    supabaseMock.__queue('products', {
      data: [
        product('prod-a', { name: 'Cafetera de A' }),
        product('prod-b', { name: 'Cafetera de B' }),
      ],
      error: null,
    });
    supabaseMock.__queue('product_stock', {
      data: [
        { product_id: 'prod-a', tenant_id: TENANT_A, stock: 7, min_stock: 2, max_stock: 9, active: true },
      ],
      error: null,
    });

    const result = await lookupProductByCode(authAsTenantA(), BARCODE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product).toMatchObject({
      id: 'prod-a',
      name: 'Cafetera de A',
      stock: 7,
      min_stock: 2,
      max_stock: 9,
      price: 1500,
    });
  });

  it('no devuelve la copia del codigo que solo tiene stock en otra empresa', async () => {
    supabaseMock.__queue('products', {
      data: [product('prod-a'), product('prod-b')],
      error: null,
    });
    supabaseMock.__queue('product_stock', {
      data: [
        { product_id: 'prod-b', tenant_id: TENANT_B, stock: 50, active: true },
      ],
      error: null,
    });

    const result = await lookupProductByCode(authAsTenantA(), BARCODE);

    expect(result).toEqual({ ok: true, product: null });
  });

  it('devuelve null (no error) para un codigo desconocido que no es un UUID', async () => {
    supabaseMock.__queue('products', { data: [], error: null });

    const result = await lookupProductByCode(authAsTenantA(), '9999999999999');

    expect(result).toEqual({ ok: true, product: null });
    // No debe consultar `products.id` con un codigo de barras: Postgres falla
    // con 22P02 al castearlo a uuid y eso convertia el "no encontrado" en 500.
    const idLookups = callsTo(supabaseMock.__calls, 'products', 'eq').filter(
      (call) => call.args[0] === 'id'
    );
    expect(idLookups).toHaveLength(0);
  });

  it('sigue aceptando un id de producto valido', async () => {
    const id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    supabaseMock.__queue('products', { data: [], error: null });
    supabaseMock.__queue('products', { data: product(id, { barcode: null }), error: null });
    supabaseMock.__queue('product_stock', {
      data: [
        { product_id: id, tenant_id: TENANT_A, stock: 3, min_stock: 0, max_stock: 10, active: true },
      ],
      error: null,
    });

    const result = await lookupProductByCode(authAsTenantA(), id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product).toMatchObject({ id, stock: 3 });
  });
});
