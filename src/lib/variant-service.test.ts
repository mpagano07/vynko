import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import {
  adjustVariantStock,
  createAttribute,
  deleteVariant,
  createVariant,
  getCriticalVariants,
  listSellableItems,
  listVariants,
  lookupSellableByCode,
  setVariantActive,
  updateVariant,
} from '@/lib/variant-service';
import type { AuthInfo } from '@/lib/api-auth';

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));

let role: string = 'owner';
vi.mock('@/lib/membership-role', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/membership-role')>();
  return { ...mod, getRoleInTenant: vi.fn(async () => role) };
});
vi.mock('@/lib/activity-log', () => ({ createActivityLog: vi.fn(async () => undefined) }));
vi.mock('@/lib/track-event', () => ({ trackEvent: vi.fn(async () => undefined) }));

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const auth: AuthInfo = {
  userId: 'user-1',
  tenantId: TENANT,
  tenantIds: [TENANT],
  allTenants: false,
  role: 'owner',
} as AuthInfo;

const variantInput = {
  label: 'Rojo / M',
  sku: 'REM-ROJO-M',
  barcode: '7790001',
  price: 15.5,
  cost: 8,
  stock: 3,
  valueIds: ['val-color-rojo', 'val-talle-m'],
};

function rpcArgs(name: string): Record<string, unknown> {
  const call = supabaseMock.rpc.mock.calls.find(([fn]) => fn === name);
  return (call?.[1] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  role = 'owner';
  supabaseMock.__reset();
});

describe('createVariant', () => {
  it('crea la variante con precio propio y deja el registro de códigos al servidor', async () => {
    supabaseMock.__rpcQueue('create_product_variant', { data: { id: 'v-1' }, error: null });

    const result = await createVariant(auth, 'p-1', variantInput);

    expect(result).toMatchObject({
      ok: true,
      data: { id: 'v-1', product_id: 'p-1', price: 15.5, cost: 8, stock: 3, label: 'Rojo / M' },
    });
    // tenant y precios NO vienen del cliente: viajan desde la sesión y se
    // convierten a centavos acá. El código se registra dentro de la misma RPC.
    expect(rpcArgs('create_product_variant')).toMatchObject({
      p_product_id: 'p-1',
      p_tenant_id: TENANT,
      p_by: 'user-1',
      p_sku: 'REM-ROJO-M',
      p_barcode: '7790001',
      p_price_cents: 1550,
      p_cost: 8,
      p_stock: 3,
      p_value_ids: ['val-color-rojo', 'val-talle-m'],
    });
  });

  it('no crea una variante que supera el stock del producto principal', async () => {
    supabaseMock.__queue('product_stock', { data: { stock: 90 }, error: null });
    supabaseMock.__queue('product_variants', {
      data: [{ variant_stock: [{ stock: 60 }] }, { variant_stock: [{ stock: 30 }] }],
      error: null,
    });

    const result = await createVariant(auth, 'p-1', { ...variantInput, stock: 10 });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: 'El total de variantes (100) no puede superar el stock del producto principal (90)',
    });
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('create_product_variant', expect.anything());
  });

  it('traduce una colisión de SKU/barcode en un error claro', async () => {
    supabaseMock.__rpcQueue('create_product_variant', {
      data: null,
      error: { message: 'duplicate_sellable_code' },
    });

    const result = await createVariant(auth, 'p-1', variantInput);

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: 'El SKU o código de barras ya lo usa otro artículo de esta sucursal',
    });
  });

  it('explica el conflicto de SKU global con una variante borrada', async () => {
    supabaseMock.__rpcQueue('create_product_variant', {
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "uq_product_variants_sku"',
        details: 'Key (product_id, sku)=(p-1, SKU-01945) already exists.',
      },
    });

    const result = await createVariant(auth, 'p-1', variantInput);

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: 'Ese SKU ya lo usa otra variante de este producto (incluso una borrada). Probá con otro o aplicá la migración 076 actualizada.',
    });
  });

  it('rechaza la creación sin capacidad de catálogo', async () => {
    role = 'viewer';

    const result = await createVariant(auth, 'p-1', variantInput);

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('exige etiqueta y al menos un valor de atributo (nada de combinaciones automáticas)', async () => {
    const noLabel = await createVariant(auth, 'p-1', { ...variantInput, label: '  ' });
    const noValues = await createVariant(auth, 'p-1', { ...variantInput, valueIds: [] });

    expect(noLabel).toMatchObject({ ok: false, status: 400 });
    expect(noValues).toMatchObject({ ok: false, status: 400 });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });
});

describe('createAttribute', () => {
  it('normaliza valores repetidos y vacíos antes de persistirlos', async () => {
    supabaseMock.__queue('product_attributes', { data: { id: 'a-1', name: 'Color' }, error: null });
    supabaseMock.__queue('product_attribute_values', { data: null, error: null });
    supabaseMock.__queue('product_attribute_values', {
      data: [
        { id: 'v-1', attribute_id: 'a-1', value: 'Azul' },
        { id: 'v-2', attribute_id: 'a-1', value: 'Rojo' },
      ],
      error: null,
    });

    const result = await createAttribute(auth, ' Color ', ['Rojo', ' Rojo ', '', 'Azul']);

    expect(result).toMatchObject({ ok: true, data: { name: 'Color' } });
    const upsert = supabaseMock.__calls.find((c) => c.table === 'product_attribute_values' && c.method === 'upsert');
    expect(upsert?.args[0]).toEqual([
      { attribute_id: 'a-1', value: 'Rojo' },
      { attribute_id: 'a-1', value: 'Azul' },
    ]);
  });
});

describe('listVariants', () => {
  it('consolida solo el stock del tenant y resuelve las etiquetas de atributos', async () => {
    supabaseMock.__queue('product_variants', {
      data: [{
        id: 'v-1',
        product_id: 'p-1',
        sku: 'V-1',
        barcode: null,
        label: 'Rojo',
        price_cents: 1500,
        cost: 5,
        product_variant_values: [{ value_id: 'val-1' }],
        variant_stock: [
          {
            tenant_id: TENANT, stock: 4, min_stock: 2, max_stock: 10, active: true,
            deposito: 'Central', pasillo: 'A', estanteria: '2', category_id: 'c-1',
          },
          {
            tenant_id: OTHER_TENANT, stock: 99, min_stock: 50, max_stock: 100, active: false,
            deposito: 'Ajeno', pasillo: 'Z', estanteria: '9', category_id: 'c-2',
          },
        ],
      }],
      error: null,
    });
    supabaseMock.__queue('product_attribute_values', {
      data: [{ id: 'val-1', attribute_id: 'a-1', value: 'Rojo' }],
      error: null,
    });

    const result = await listVariants(auth, 'p-1');
    if (!result.ok) throw new Error(result.error);

    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: 'v-1',
      price: 15,
      cost: 5,
      stock: 4,
      min_stock: 2,
      max_stock: 10,
      active: true,
      deposito: 'Central',
      values: [{ value: 'Rojo' }],
    });
  });
});

describe('lookupSellableByCode', () => {
  it('resuelve un código de variante directamente al artículo vendible', async () => {
    supabaseMock.__queue('sellable_codes', {
      data: [{ kind: 'variant', tenant_id: TENANT, product_id: 'p-1', variant_id: 'v-1', code: '7790001' }],
      error: null,
    });
    // `maybeSingle()` devuelve un objeto, no un array: el mock no transforma
    // la fila encolada, así que hay que encolar la misma forma que PostgREST.
    supabaseMock.__queue('product_variants', {
      data: {
        id: 'v-1',
        product_id: 'p-1',
        sku: 'V-1',
        barcode: '7790001',
        label: 'Rojo / M',
        price_cents: 1500,
        cost: 6,
        product: {
          id: 'p-1', name: 'Remera', description: null, sku: 'P-1',
          barcode: null, price_cents: 1000, cost: 4,
        },
        variant_stock: [{ tenant_id: TENANT, stock: 3, active: true }],
      },
      error: null,
    });

    const result = await lookupSellableByCode(auth, '7790001');
    if (!result.ok) throw new Error(result.error);

    expect(result.data).toMatchObject({
      kind: 'variant',
      id: 'v-1',
      productId: 'p-1',
      variantId: 'v-1',
      name: 'Remera',
      variantLabel: 'Rojo / M',
      displayName: 'Remera · Rojo / M',
      price: 15,
      stock: 3,
    });
  });

  it('rechaza un código ambiguo heredado en vez de elegir un dueño al azar', async () => {
    supabaseMock.__queue('sellable_codes', {
      data: [
        { kind: 'sku', tenant_id: TENANT, product_id: 'p-1', variant_id: null, code: 'DUP' },
        { kind: 'barcode', tenant_id: TENANT, product_id: 'p-2', variant_id: null, code: 'DUP' },
      ],
      error: null,
    });

    const result = await lookupSellableByCode(auth, 'DUP');
    if (!result.ok) throw new Error(result.error);

    expect(result.data).toBeNull();
  });

  it('no devuelve el padre cuando el código histórico pertenece a un producto con variantes', async () => {
    supabaseMock.__queue('sellable_codes', { data: [], error: null });
    supabaseMock.__queue('products', {
      data: [{
        id: 'p-1', name: 'Remera', description: null, sku: 'P-1', barcode: 'P-1',
        price_cents: 1000, cost: 4,
        product_stock: [{ tenant_id: TENANT, stock: 5, active: true }],
      }],
      error: null,
    });
    supabaseMock.__queue('products', {
      data: {
        id: 'p-1', name: 'Remera', description: null, sku: 'P-1', barcode: 'P-1',
        price_cents: 1000, cost: 4,
        product_stock: [{ tenant_id: TENANT, stock: 5, active: true }],
      },
      error: null,
    });
    supabaseMock.__queue('product_variants', {
      data: [{ id: 'v-1', variant_stock: [{ tenant_id: TENANT, active: true }] }],
      error: null,
    });

    const result = await lookupSellableByCode(auth, 'P-1');
    if (!result.ok) throw new Error(result.error);

    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
  });
});

describe('listSellableItems', () => {
  it('ofrece cada variante con su precio propio y nunca el padre como artículo vendible', async () => {
    supabaseMock.__queue('products', {
      data: [
        {
          id: 'p-1', name: 'Remera', description: null, sku: 'P-1', barcode: null,
          price_cents: 1000, cost: 4,
          product_stock: [{ tenant_id: TENANT, stock: 7, active: true }],
          product_variants: [{
            id: 'v-1', sku: 'V-1', barcode: null, label: 'Rojo',
            price_cents: 1500, cost: 6,
            variant_stock: [{ tenant_id: TENANT, stock: 2, active: true }],
          }],
        },
        {
          id: 'p-2', name: 'Café', description: null, sku: 'P-2', barcode: 'CAFE',
          price_cents: 800, cost: 3,
          product_stock: [{ tenant_id: TENANT, stock: 9, active: true }],
          product_variants: [],
        },
      ],
      error: null,
    });

    const result = await listSellableItems(auth);
    if (!result.ok) throw new Error(result.error);

    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      kind: 'variant', id: 'v-1', productId: 'p-1', price: 15, stock: 2,
      displayName: 'Remera · Rojo',
    });
    expect(result.data[0].id).not.toBe('p-1');
    expect(result.data[1]).toMatchObject({
      kind: 'product', id: 'p-2', price: 8, stock: 9, displayName: 'Café',
    });
  });
});

describe('updateVariant · stock desde el formulario de edición', () => {
  const updatedRow = {
    id: 'v-1',
    product_id: 'p-1',
    sku: 'REM-ROJO-M',
    barcode: '7790001',
    label: 'Rojo / M',
    price_cents: 1550,
    cost: 8,
  };

  it('aplica el stock final como delta por RPC y registra el movimiento', async () => {
    supabaseMock.__queue('variant_stock', { data: { stock: 90 }, error: null });
    supabaseMock.__rpcQueue('update_product_variant', { data: updatedRow, error: null });
    supabaseMock.__queue('variant_stock', { data: { stock: 90 }, error: null });
    supabaseMock.__rpcQueue('adjust_variant_stock_atomic', {
      data: [{ ok: true, old_stock: 90, new_stock: 45 }],
      error: null,
    });

    const result = await updateVariant(auth, 'v-1', { ...variantInput, stock: 45 });

    expect(result).toMatchObject({ ok: true, data: { stock: 45 } });
    expect(rpcArgs('adjust_variant_stock_atomic')).toMatchObject({
      p_variant_id: 'v-1',
      p_tenant_id: TENANT,
      p_quantity: -45,
      p_reason: 'Edición de variante: Stock fijado en 45',
      p_created_by: 'user-1',
    });
  });

  it('no toca el stock si el formulario manda el mismo valor', async () => {
    supabaseMock.__queue('variant_stock', { data: { stock: 90 }, error: null });
    supabaseMock.__rpcQueue('update_product_variant', { data: updatedRow, error: null });

    const result = await updateVariant(auth, 'v-1', { ...variantInput, stock: 90 });

    expect(result).toMatchObject({ ok: true, data: { stock: 90 } });
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('adjust_variant_stock_atomic', expect.anything());
  });

  it('guarda la ubicación y la categoría en variant_stock del tenant', async () => {
    supabaseMock.__queue('variant_stock', { data: { stock: 90 }, error: null });
    supabaseMock.__rpcQueue('update_product_variant', { data: updatedRow, error: null });

    const result = await updateVariant(auth, 'v-1', {
      ...variantInput,
      stock: 90,
      deposito: 'Depósito norte',
      pasillo: 'B',
      estanteria: '3',
      category_id: 'c-1',
    });

    expect(result).toMatchObject({
      ok: true,
      data: { deposito: 'Depósito norte', pasillo: 'B', estanteria: '3', category_id: 'c-1' },
    });
    const calls = supabaseMock.__calls.filter((call) => call.table === 'variant_stock');
    const updateIndex = calls.findIndex((call) => call.method === 'update');
    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(calls[updateIndex]?.args[0]).toMatchObject({
      deposito: 'Depósito norte',
      pasillo: 'B',
      estanteria: '3',
      category_id: 'c-1',
    });
    expect(calls[updateIndex + 1]).toMatchObject({ method: 'eq', args: ['variant_id', 'v-1'] });
    expect(calls[updateIndex + 2]).toMatchObject({ method: 'eq', args: ['tenant_id', TENANT] });
  });

  it('un PATCH sin ubicación no borra la ubicación existente', async () => {
    supabaseMock.__queue('variant_stock', { data: { stock: 90 }, error: null });
    supabaseMock.__rpcQueue('update_product_variant', { data: updatedRow, error: null });

    await updateVariant(auth, 'v-1', { ...variantInput, stock: 90 });

    expect(supabaseMock.__calls.some((call) => call.table === 'variant_stock' && call.method === 'update')).toBe(false);
  });

  it('no guarda un stock final que supera el tope del producto', async () => {
    supabaseMock.__queue('variant_stock', { data: { stock: 30 }, error: null }); // stock previo de la variante
    supabaseMock.__queue('product_variants', { data: { product_id: 'p-1' }, error: null }); // dueño de la variante
    supabaseMock.__queue('product_stock', { data: { stock: 90 }, error: null }); // tope
    supabaseMock.__queue('product_variants', {
      data: [{ variant_stock: [{ stock: 30 }] }, { variant_stock: [{ stock: 30 }] }, { variant_stock: [{ stock: 30 }] }],
      error: null,
    });

    const result = await updateVariant(auth, 'v-1', { ...variantInput, stock: 100 });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: 'El total de variantes (160) no puede superar el stock del producto principal (90)',
    });
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('update_product_variant', expect.anything());
  });
});

describe('deleteVariant', () => {
  it('borra la variante del tenant por RPC y registra la baja', async () => {
    supabaseMock.__rpcQueue('delete_product_variant', {
      data: { ok: true, label: 'Rojo / M' },
      error: null,
    });

    const result = await deleteVariant(auth, 'v-1');

    expect(result).toMatchObject({ ok: true, data: { label: 'Rojo / M' } });
    expect(rpcArgs('delete_product_variant')).toEqual({
      p_variant_id: 'v-1',
      p_tenant_id: TENANT,
    });
  });

  it('avisa si la RPC de baja todavía no está aplicada en la base', async () => {
    supabaseMock.__rpcQueue('delete_product_variant', {
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.delete_product_variant(p_tenant_id, p_variant_id) in the schema cache',
      },
    });

    const result = await deleteVariant(auth, 'v-1');

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: 'Falta aplicar la migración 076_delete_product_variant.sql en la base de datos',
    });
  });

  it('no confunde una variante de otra sucursal con una baja local', async () => {
    supabaseMock.__rpcQueue('delete_product_variant', {
      data: null,
      error: { message: 'variant_not_in_tenant' },
    });

    const result = await deleteVariant(auth, 'v-2');

    expect(result).toMatchObject({ ok: false, status: 404, error: 'Variante no encontrada en tu sucursal' });
  });

  it('rechaza borrar una variante con transferencia o compra pendiente', async () => {
    supabaseMock.__rpcQueue('delete_product_variant', {
      data: null,
      error: { message: 'variant_in_use' },
    });

    const result = await deleteVariant(auth, 'v-1');

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringMatching(/pendiente/),
    });
  });
});

describe('setVariantActive / adjustVariantStock', () => {
  it('desactiva solo la fila del tenant', async () => {
    supabaseMock.__queue('variant_stock', { data: { id: 'vs-1' }, error: null });

    const result = await setVariantActive(auth, 'v-1', false);

    expect(result).toMatchObject({ ok: true, data: { ok: true } });
    const tenantFilter = supabaseMock.__calls.find(
      (c) => c.table === 'variant_stock' && c.method === 'eq' && c.args[0] === 'tenant_id'
    );
    expect(tenantFilter?.args[1]).toBe(TENANT);
  });

  it('rechaza un ajuste que dejaría stock negativo antes de llamar a la RPC', async () => {
    supabaseMock.__queue('variant_stock', { data: { stock: 2 }, error: null });

    const result = await adjustVariantStock(auth, 'v-1', -5, 'merma');

    expect(result).toMatchObject({ ok: false, status: 400, error: 'El stock no puede ser negativo' });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('aclara el stock de la variante por RPC atómica y respeta un rechazo por carrera', async () => {
    supabaseMock.__queue('variant_stock', { data: { stock: 2 }, error: null });
    supabaseMock.__rpcQueue('adjust_variant_stock_atomic', {
      data: [{ ok: true, old_stock: 2, new_stock: 5 }],
      error: null,
    });

    const ok = await adjustVariantStock(auth, 'v-1', 3, 'ingreso');
    expect(ok).toMatchObject({ ok: true, data: { previousStock: 2, newStock: 5 } });
    expect(rpcArgs('adjust_variant_stock_atomic')).toMatchObject({
      p_variant_id: 'v-1',
      p_tenant_id: TENANT,
      p_quantity: 3,
      p_created_by: 'user-1',
    });

    supabaseMock.__queue('variant_stock', { data: { stock: 1 }, error: null });
    supabaseMock.__rpcQueue('adjust_variant_stock_atomic', {
      data: [{ ok: false, error: 'insufficient_stock' }],
      error: null,
    });
    const raced = await adjustVariantStock(auth, 'v-1', -2, 'merma');
    expect(raced).toMatchObject({ ok: false, status: 400 });
  });
});

describe('getCriticalVariants', () => {
  it('devuelve el nombre completo y filtra por los tenants de la sesión', async () => {
    supabaseMock.__rpcQueue('get_critical_variants', {
      data: [{
        id: 'v-1', product_id: 'p-1', name: 'Remera', label: 'Rojo',
        sku: 'V-1', stock: 1, min_stock: 2,
      }],
      error: null,
    });

    const result = await getCriticalVariants(auth);
    if (!result.ok) throw new Error(result.error);

    expect(result.data[0]).toMatchObject({
      stock: 1, min_stock: 2, display_name: 'Remera · Rojo',
    });
    expect(rpcArgs('get_critical_variants')).toEqual({ p_tenant_ids: [TENANT] });
  });
});
