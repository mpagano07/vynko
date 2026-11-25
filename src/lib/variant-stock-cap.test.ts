import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { readVariantStockCap, variantStockCapError } from '@/lib/variant-stock-cap';

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));

beforeEach(() => supabaseMock.__reset());

describe('readVariantStockCap', () => {
  it('suma sólo el stock de las variantes del tenant y lee el tope del padre', async () => {
    supabaseMock.__queue('product_stock', { data: { stock: 90 }, error: null });
    supabaseMock.__queue('product_variants', {
      data: [
        { variant_stock: [{ stock: 30 }] },
        { variant_stock: [{ stock: 30 }] },
        { variant_stock: [{ stock: 30 }] },
      ],
      error: null,
    });

    await expect(readVariantStockCap('p-1', 't1')).resolves.toEqual({ cap: 90, total: 90 });
  });

  it('devuelve cap null si el producto no pertenece al tenant', async () => {
    supabaseMock.__queue('product_stock', { data: null, error: null });
    supabaseMock.__queue('product_variants', { data: [], error: null });

    await expect(readVariantStockCap('p-1', 't1')).resolves.toEqual({ cap: null, total: 0 });
  });
});

describe('variantStockCapError', () => {
  it('explica el tope con ambos números', () => {
    expect(variantStockCapError(90, 100)).toBe('El total de variantes (100) no puede superar el stock del producto principal (90)');
  });
});
