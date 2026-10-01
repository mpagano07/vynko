import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import { __resetRateLimitStateForTests } from '@/lib/rate-limit';
import { MAX_IMPORT_ROWS } from './excel-import-parse';
import { buildStockMovement } from './stock';
import { importProducts, LOOKUP_CHUNK, prepareImport, WRITE_CHUNK } from './product-service';

const auth = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  allTenants: false,
  tenantIds: ['tenant-1'],
};

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: supabaseMock }));
vi.mock('@/lib/activity-log', () => ({ createActivityLog: vi.fn(async () => undefined) }));
vi.mock('@/lib/track-event', () => ({ trackEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/upload-service', () => ({
  isAllowedImagePath: vi.fn(() => true),
  signProductImageUrls: vi.fn(async () => ({})),
}));

// `stock` es real salvo `buildStockMovement`, que se usa para inyectar una
// excepcion a mitad de un archivo sin tener que falsear el mock de Supabase.
vi.mock('./stock', async () => {
  const actual = await vi.importActual<typeof import('./stock')>('./stock');
  return { ...actual, buildStockMovement: vi.fn(actual.buildStockMovement) };
});

/**
 * Deja al owner en un plan sin tope de productos, para que los tests que
 * miden volumen no se crucen con el limite de 50 del plan starter.
 */
function asOwner(plan = 'business') {
  supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
  supabaseMock.__queue('tenants', { data: { subscription_plan: plan }, error: null });
}

/**
 * Cola las respuestas de `products` para N filas nuevas que traen SKU.
 *
 * El lookup de SKU va primero y en lotes (uno cada `LOOKUP_CHUNK` SKUs), asi
 * que se encola una respuesta vacia por lote para que ninguna fila resuelva a
 * un producto existente. Despues van los inserts, tambien en lotes de
 * `WRITE_CHUNK`: el alta se escribe de a varias filas y por eso el insert ya no
 * trae el id de vuelta (lo genera el codigo).
 *
 * `failAtRow` es 1-based y marca la fila cuyo insert falla. Como el fallo se
 * pega al lote entero, el lote que la contiene se simula caido y despues se
 * encolan los inserts individuales del reintento: la fila `failAtRow` es la
 * unica que vuelve a fallar.
 */
function queueNewProducts(count: number, failAtRow?: number) {
  const results: Record<string, unknown>[] = [];
  for (let c = 0; c < Math.max(1, Math.ceil(count / LOOKUP_CHUNK)); c++) {
    results.push({ data: [], error: null });
  }
  for (let start = 0; start < count; start += WRITE_CHUNK) {
    const end = Math.min(start + WRITE_CHUNK, count);
    const caeElLote = failAtRow !== undefined && failAtRow > start && failAtRow <= end;
    results.push(caeElLote ? { data: null, error: { message: 'deadlock detected' } } : { data: null, error: null });
    if (!caeElLote) continue;
    for (let i = start; i < end; i++) {
      results.push(
        i + 1 === failAtRow
          ? { data: null, error: { message: 'deadlock detected' } }
          : { data: null, error: null },
      );
    }
  }
  supabaseMock.__queue('products', ...results);
}

function insertsOn(table: string) {
  return supabaseMock.__calls.filter((c) => c.table === table && c.method === 'insert');
}

function upsertsOn(table: string) {
  return supabaseMock.__calls.filter((c) => c.table === table && c.method === 'upsert');
}

function updatesOn(table: string) {
  return supabaseMock.__calls.filter((c) => c.table === table && c.method === 'update');
}

/** Filas del lote `n` que se insertó en `products` (el alta va multi-fila). */
function insertedProductRows(n = 0) {
  const call = insertsOn('products')[n];
  return (call?.args[0] ?? []) as Record<string, unknown>[];
}

describe('importProducts: guardas de entrada', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('rechaza un Excel vacio sin tocar la base', async () => {
    const result = await importProducts(auth, []);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('rechaza un payload que no es una lista', async () => {
    const result = await importProducts(auth, undefined);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('deja entrar a un member pero no a un desconocido', async () => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    supabaseMock.__queue('tenant_users', { data: { role: 'member' }, error: null });
    const result = await importProducts(auth, [{ name: 'Coca' }]);
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(insertsOn('products')).toHaveLength(0);
  });
});

describe('importProducts: límites de consumo', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('corta un archivo con más filas que el máximo, sin tocar la base', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ name: `P${i}` }));
    const result = await importProducts(auth, rows);

    expect(result).toMatchObject({ ok: false, status: 413 });
    expect(result.ok === false && result.error).toContain(String(MAX_IMPORT_ROWS));
    expect(supabaseMock.__calls).toHaveLength(0);
  });

  it('deja pasar exactamente el máximo de filas', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' }, error: null });
    supabaseMock.__queue('categories', { data: [], error: null });
    // Sin SKU: cada fila consume solo su insert.
    const creates = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => ({
      data: { id: `prod-${i}` },
      error: null,
    }));
    supabaseMock.__queue('products', ...creates);

    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => ({ name: `P${i}` }));
    const result = await importProducts(auth, rows);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.summary.created).toBe(MAX_IMPORT_ROWS);
  });

  it('devuelve 429 al superar el límite por usuario', async () => {
    // Cada import consume una respuesta de rol, de plan y de categorías.
    for (let i = 0; i < 10; i++) {
      supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
      supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' }, error: null });
      supabaseMock.__queue('categories', { data: [], error: null });
      supabaseMock.__queue('products', { data: { id: `prod-${i}` }, error: null });

      const ok = await importProducts(auth, [{ name: `P${i}` }]);
      expect(ok.ok, `import ${i + 1}`).toBe(true);
    }

    // El limite corta antes de tocar la base: no hay fila 11.
    const bloqueado = await importProducts(auth, [{ name: 'P11' }]);
    expect(bloqueado).toMatchObject({ ok: false, status: 429 });
    expect(insertsOn('products')).toHaveLength(10);
  });

  it('el límite por usuario se cuenta aparte del de tenant', async () => {
    for (let i = 0; i < 10; i++) {
      supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
      supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' }, error: null });
      supabaseMock.__queue('categories', { data: [], error: null });
      supabaseMock.__queue('products', { data: { id: `prod-${i}` }, error: null });
      await importProducts(auth, [{ name: `P${i}` }]);
    }

    // Mismo tenant, otro usuario: el contador por usuario arranca en cero y el
    // de tenant recien va por 11 de 30.
    const otro = { ...auth, userId: 'user-2' };
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'business' }, error: null });
    supabaseMock.__queue('categories', { data: [], error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-otro' }, error: null });

    const result = await importProducts(otro, [{ name: 'Otro' }]);
    expect(result.ok).toBe(true);
  });
});

describe('importProducts: SKU duplicado e inexistente', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    asOwner();
  });

  it('crea el producto cuando el SKU no existe todavia', async () => {
    // products: 1) busqueda por SKU -> vacio  2) insert -> ok
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    const result = await importProducts(auth, [{ name: 'Coca', sku: 'COC-1', price: 150, stock: 10 }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.summary).toEqual({ created: 1, updated: 0, skipped: 0, total: 1 });
    expect(insertedProductRows()[0]).toMatchObject({ name: 'Coca', sku: 'COC-1' });
  });

  it('actualiza el producto cuando el SKU ya existe en el tenant', async () => {
    // products: 1) busqueda en bloque por SKU -> existe
    supabaseMock.__queue('products', { data: [{ id: 'prod-9', sku: 'COC-1' }], error: null });
    supabaseMock.__queue('product_stock', { data: { stock: 5, min_stock: 1, max_stock: 50 }, error: null });

    const result = await importProducts(auth, [{ name: 'Coca', sku: 'COC-1', price: 150, stock: 12 }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.summary).toEqual({ created: 0, updated: 1, skipped: 0, total: 1 });
    expect(insertsOn('products')).toHaveLength(0);
    expect(upsertsOn('product_stock')[0].args[0]).toMatchObject({ product_id: 'prod-9', stock: 12 });
  });

  it('el mismo SKU repetido en el archivo actualiza en vez de duplicar', async () => {
    // 1) busqueda en bloque: ninguno existe todavia.
    supabaseMock.__queue('products', { data: [], error: null });
    // 2) Fila 1 crea prod-1 y lo registra en memoria; la fila 2 ya lo resuelve.
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });
    supabaseMock.__queue('product_stock', { data: { stock: 3, min_stock: 0, max_stock: 0 }, error: null });

    const result = await importProducts(auth, [
      { name: 'Coca', sku: 'COC-1', price: 150, stock: 3 },
      { name: 'Coca (precio nuevo)', sku: 'COC-1', price: 175 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.summary).toEqual({ created: 1, updated: 1, skipped: 0, total: 2 });
    // Un solo producto creado: el repetido no se coló como uno nuevo.
    expect(insertsOn('products')).toHaveLength(1);
  });

  it('busca por codigo de barras cuando no hay SKU', async () => {
    // products: 1) busqueda en bloque por barcode -> existe
    supabaseMock.__queue('products', { data: [{ id: 'prod-7', barcode: '7790001234567' }], error: null });
    supabaseMock.__queue('product_stock', { data: { stock: 2, min_stock: 0, max_stock: 0 }, error: null });

    const result = await importProducts(auth, [{ name: 'Coca', barcode: '7790001234567', stock: 2 }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.results[0].status).toBe('updated');
    const lookup = supabaseMock.__calls.filter(
      (c) => c.table === 'products' && c.method === 'in' && c.args[0] === 'barcode',
    );
    expect(lookup).toHaveLength(1);
  });

  it('no toca productos de otro tenant: el scope viene del product_stock', async () => {
    // El SKU existe, pero para otro tenant: el select con !inner no trae nada.
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-nuevo' }, error: null });

    const result = await importProducts(auth, [{ name: 'Coca', sku: 'COC-1', price: 100 }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.results[0].status).toBe('created');
    const tenantFilters = supabaseMock.__calls.filter(
      (c) => c.table === 'products' && c.method === 'eq' && c.args[0] === 'product_stock.tenant_id',
    );
    expect(tenantFilters.every((c) => c.args[1] === 'tenant-1')).toBe(true);
  });
});

describe('importProducts: precio y stock', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    asOwner();
  });

  it('un precio vacio no deja el producto en cero', async () => {
    supabaseMock.__queue('products', { data: [{ id: 'prod-9', sku: 'COC-1' }], error: null });
    supabaseMock.__queue('product_stock', { data: { stock: 7, min_stock: 2, max_stock: 30 }, error: null });

    const result = await importProducts(auth, [{ name: 'Coca', sku: 'COC-1', price: '' }]);

    expect(result.ok).toBe(true);
    const payload = updatesOn('products')[0].args[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('price_cents');
    expect(payload.name).toBe('Coca');
  });

  it('un precio ausente tampoco se escribe como 0', async () => {
    supabaseMock.__queue('products', { data: [{ id: 'prod-9', sku: 'COC-1' }], error: null });
    supabaseMock.__queue('product_stock', { data: { stock: 7, min_stock: 2, max_stock: 30 }, error: null });

    await importProducts(auth, [{ name: 'Coca', sku: 'COC-1' }]);

    const payload = updatesOn('products')[0].args[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('price_cents');
  });

  it('guarda el precio en centavos', async () => {
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    await importProducts(auth, [{ name: 'Coca', price: 1234.56 }]);

    expect(insertedProductRows()[0]).toMatchObject({ price_cents: 123456 });
  });

  it('omite la fila cuando el precio no es un numero', async () => {
    const result = await importProducts(auth, [{ name: 'Coca', price: NaN }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.results[0]).toMatchObject({
      row: 1,
      status: 'skipped',
      error: 'El precio debe ser un número',
    });
    expect(insertsOn('products')).toHaveLength(0);
  });

  it('omite la fila cuando el precio es negativo', async () => {
    const result = await importProducts(auth, [{ name: 'Coca', price: -10 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.results[0].error).toBe('El precio no puede ser negativo');
  });

  it('omite la fila cuando el costo no es un numero no negativo', async () => {
    const result = await importProducts(auth, [{ name: 'Coca', cost: -5 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.results[0].error).toBe('El costo debe ser un número no negativo');
  });

  it('omite la fila con stock negativo sin tocar los demas', async () => {
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    const result = await importProducts(auth, [
      { name: 'Coca', sku: 'COC-1', stock: 10 },
      { name: 'Pepsi', sku: 'PEP-1', stock: -5 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.results[1]).toMatchObject({
      row: 2,
      status: 'skipped',
      name: 'Pepsi',
      error: 'El stock no puede ser negativo',
    });
    expect(result.body.summary.created).toBe(1);
  });

  it('omite la fila con stock decimal', async () => {
    const result = await importProducts(auth, [{ name: 'Coca', stock: 2.5 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.results[0].error).toBe('El stock debe ser un número entero');
  });

  it('un stock vacio conserva el del producto en vez de dejarlo en 0', async () => {
    supabaseMock.__queue('products', { data: [{ id: 'prod-9', sku: 'COC-1' }], error: null });
    supabaseMock.__queue('product_stock', { data: { stock: 40, min_stock: 5, max_stock: 100 }, error: null });

    const result = await importProducts(auth, [{ name: 'Coca', sku: 'COC-1', stock: '' }]);

    expect(result.ok).toBe(true);
    expect(upsertsOn('product_stock')[0].args[0]).toMatchObject({
      product_id: 'prod-9',
      stock: 40,
      min_stock: 5,
      max_stock: 100,
    });
    // Sin cambio de stock, tampoco hay que dejar un movimiento en el historial.
    expect(insertsOn('stock_history')).toHaveLength(0);
  });

  it('deja el movimiento de stock en el historial cuando el stock cambia', async () => {
    supabaseMock.__queue('products', { data: [{ id: 'prod-9', sku: 'COC-1' }], error: null });
    supabaseMock.__queue('product_stock', { data: { stock: 10, min_stock: 0, max_stock: 0 }, error: null });

    await importProducts(auth, [{ name: 'Coca', sku: 'COC-1', stock: 25 }]);

    expect(insertsOn('stock_history')[0].args[0]).toMatchObject({
      product_id: 'prod-9',
      tenant_id: 'tenant-1',
      quantity: 15,
      type: 'adjustment',
      reason: 'Importación de productos',
    });
  });

  it('omite la fila sin nombre pero sigue importando las otras', async () => {
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    const result = await importProducts(auth, [{ name: '   ' }, { name: 'Coca', sku: 'COC-1' }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.results[0]).toMatchObject({ row: 1, status: 'skipped', error: 'Nombre requerido' });
    expect(result.body.results[1].status).toBe('created');
  });
});

describe('importProducts: acentos, caracteres especiales y columnas desconocidas', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    asOwner();
  });

  it('guarda el nombre con acentos y caracteres especiales tal cual', async () => {
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    const name = 'Jamón "Crudo" & Cía. <500g> — Ñoqui';
    const result = await importProducts(auth, [{ name, sku: 'JAM-1' }]);

    expect(result.ok).toBe(true);
    expect(insertedProductRows()[0]).toMatchObject({ name });
    expect(result.ok && result.body.results[0].name).toBe(name);
  });

  it('descarta las columnas que no estan en la lista blanca', async () => {
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    await importProducts(auth, [
      { name: 'Coca', sku: 'COC-1', price: 100, 'Columna Rara': 'basura', Clave: 'X' },
    ]);

    const payload = insertedProductRows()[0];
    expect(payload).not.toHaveProperty('Columna Rara');
    expect(payload).not.toHaveProperty('Clave');
    expect(payload).toMatchObject({ name: 'Coca', sku: 'COC-1', price_cents: 10000 });
  });

  it('una planilla que solo trae columnas desconocidas omite todas las filas', async () => {
    const result = await importProducts(auth, [
      { ColumnaRara: 'a' },
      { Otra: 'b' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.summary).toEqual({ created: 0, updated: 0, skipped: 2, total: 2 });
    expect(insertsOn('products')).toHaveLength(0);
  });
});

describe('importProducts: categorías nuevas', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    asOwner();
  });

  it('lee el catalogo de categorias una sola vez por archivo', async () => {
    supabaseMock.__queue('categories', { data: [{ id: 'cat-1', name: 'Bebidas', color: '#3b82f6' }], error: null });
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    await importProducts(auth, [{ name: 'Coca', sku: 'COC-1', category_name: 'Bebidas' }]);

    // Una lectura inicial y nada mas: antes cada fila hacia hasta dos
    // consultas de `categories`, o sea 4000 para un archivo de 2000 filas.
    const lecturas = supabaseMock.__calls.filter(
      (c) => c.table === 'categories' && (c.method === 'select' || c.method === 'eq'),
    );
    expect(lecturas.filter((c) => c.method === 'eq')).toHaveLength(1);
  });

  it('crea la categoría si no existe y la asigna al producto', async () => {
    // categories: 1) lectura del catalogo (vacio)  2) insert de la nueva
    supabaseMock.__queue('categories', { data: [], error: null });
    supabaseMock.__queue('categories', { data: { id: 'cat-1' }, error: null });
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    const result = await importProducts(auth, [
      { name: 'Coca', sku: 'COC-1', category_name: 'Bebidas' },
    ]);

    expect(result.ok).toBe(true);
    expect(insertsOn('categories')[0].args[0]).toMatchObject({ tenant_id: 'tenant-1', name: 'Bebidas' });
    expect(insertedProductRows()[0]).toMatchObject({ category_id: 'cat-1' });
  });

  it('reutiliza la categoría existente y no crea otra', async () => {
    supabaseMock.__queue('categories', { data: [{ id: 'cat-existente', name: 'Bebidas', color: null }], error: null });
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    await importProducts(auth, [{ name: 'Coca', sku: 'COC-1', category_name: 'Bebidas' }]);

    expect(insertsOn('categories')).toHaveLength(0);
    expect(insertedProductRows()[0]).toMatchObject({ category_id: 'cat-existente' });
  });

  it('encuentra la categoría ignorando mayúsculas', async () => {
    supabaseMock.__queue('categories', { data: [{ id: 'cat-1', name: 'Bebidas', color: null }], error: null });
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    await importProducts(auth, [{ name: 'Coca', sku: 'COC-1', category_name: 'bEBIDas' }]);

    expect(insertsOn('categories')).toHaveLength(0);
    expect(insertedProductRows()[0]).toMatchObject({ category_id: 'cat-1' });
  });

  it('encuentra la categoría ignorando acentos: Almacén reutiliza Almacen', async () => {
    // Postgres `ilike` es sensible a acentos, asi que antes esto creaba dos
    // categorías distintas para el mismo mostrador.
    supabaseMock.__queue('categories', { data: [{ id: 'cat-1', name: 'Almacen', color: null }], error: null });
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    await importProducts(auth, [{ name: 'Fideos', sku: 'FIE-1', category_name: 'Almacén' }]);

    expect(insertsOn('categories')).toHaveLength(0);
    expect(insertedProductRows()[0]).toMatchObject({ category_id: 'cat-1' });
  });

  it('no crea dos veces la misma categoría dentro del mismo archivo', async () => {
    supabaseMock.__queue('categories', { data: [], error: null });
    supabaseMock.__queue('categories', { data: { id: 'cat-nueva' }, error: null });
    supabaseMock.__queue('products', { data: [], error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-2' }, error: null });

    await importProducts(auth, [
      { name: 'Coca', sku: 'COC-1', category_name: 'Bebidas' },
      { name: 'Pepsi', sku: 'PEP-1', category_name: 'bebidas' },
    ]);

    // Una sola categoria para las dos filas, aunque el nombre difiera en el
    // case: el indice en memoria se actualiza en cada alta.
    expect(insertsOn('categories')).toHaveLength(1);
    expect(
      insertedProductRows().map((row) => row.category_id),
    ).toEqual(['cat-nueva', 'cat-nueva']);
  });

  it('crea la categoría con un color que no este repetido', async () => {
    supabaseMock.__queue('categories', {
      data: [
        { id: 'cat-a', name: 'A', color: '#8b5cf6' },
        { id: 'cat-b', name: 'B', color: '#06b6d4' },
      ],
      error: null,
    });
    supabaseMock.__queue('categories', { data: { id: 'cat-nueva' }, error: null });
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    await importProducts(auth, [{ name: 'Coca', sku: 'COC-1', category_name: 'Bebidas' }]);

    const creado = insertsOn('categories')[0].args[0] as { color: string };
    expect(['#8b5cf6', '#06b6d4']).not.toContain(creado.color);
  });

  it('un nombre de categoría vacío no crea nada', async () => {
    supabaseMock.__queue('categories', { data: [], error: null });
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    await importProducts(auth, [{ name: 'Coca', sku: 'COC-1', category_name: '   ' }]);

    expect(insertsOn('categories')).toHaveLength(0);
  });

  it('si la categoría falla, el producto se importa igual sin categoría', async () => {
    supabaseMock.__queue('categories', { data: [], error: null });
    supabaseMock.__queue('categories', { data: null, error: { message: 'boom' } });
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    const result = await importProducts(auth, [
      { name: 'Coca', sku: 'COC-1', category_name: 'Bebidas' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.results[0].status).toBe('created');
    expect(insertedProductRows()[0]).not.toHaveProperty('category_id');
  });

  it('nunca escribe el texto "undefined" como categoria_id', async () => {
    // Un insert que responde sin id (no es lo normal, pero el cliente HTTP no
    // garantiza forma) terminaba guardando el string "undefined" en la FK.
    supabaseMock.__queue('categories', { data: [], error: null });
    supabaseMock.__queue('categories', { data: { sinId: true }, error: null });
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });

    await importProducts(auth, [{ name: 'Coca', sku: 'COC-1', category_name: 'Bebidas' }]);

    expect(insertedProductRows()[0]).not.toHaveProperty('category_id');
  });
});

describe('importProducts: productos duplicados', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    asOwner();
  });

  it('dos filas identicas sin SKU crean dos productos (el SKU es la clave)', async () => {
    // Sin SKU ni codigo de barras no hay busqueda previa: cada fila solo
    // consume la respuesta de su insert.
    supabaseMock.__queue(
      'products',
      { data: { id: 'prod-1' }, error: null },
      { data: { id: 'prod-2' }, error: null },
    );

    const result = await importProducts(auth, [
      { name: 'Coca', price: 150 },
      { name: 'Coca', price: 150 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.summary.created).toBe(2);
    // Un solo insert con las dos filas: el alta va en lote.
    expect(insertsOn('products')).toHaveLength(1);
    expect(insertedProductRows()).toHaveLength(2);
  });

  it('no depende de que el insert devuelva la fila creada', async () => {
    // El alta va en lote y no pide el id de vuelta: lo genera el codigo con
    // `randomUUID()` y lo escribe en la fila. Antes se usaba el id que
    // devolvia la base, y una respuesta sin id dejaba la fila fuera del
    // reporte (menos filas que el archivo y numeracion inservible).
    supabaseMock.__queue('products', { data: null, error: null });

    const result = await importProducts(auth, [{ name: 'Coca', price: 150 }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.results).toHaveLength(1);
    expect(result.body.results[0]).toMatchObject({ row: 1, status: 'created' });
    expect(result.body.summary).toMatchObject({ created: 1, skipped: 0, total: 1 });
    // El id se genera antes de escribir, asi que la fila insertada ya lo trae.
    expect(insertedProductRows()[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('el ultimo valor gana cuando el mismo SKU aparece dos veces', async () => {
    supabaseMock.__queue('products', { data: null, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });
    supabaseMock.__queue('products', { data: { id: 'prod-1' }, error: null });
    supabaseMock.__queue('product_stock', { data: { stock: 10, min_stock: 0, max_stock: 0 }, error: null });

    const result = await importProducts(auth, [
      { name: 'Coca', sku: 'COC-1', price: 150 },
      { name: 'Coca', sku: 'COC-1', price: 190 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const update = updatesOn('products')[0].args[0] as Record<string, unknown>;
    expect(update.price_cents).toBe(19000);
  });
});

describe('importProducts: Excel enorme', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    asOwner();
  });

  it('importa 2000 filas y devuelve un resultado por fila', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      name: `Producto ${i}`,
      sku: `SKU-${i}`,
      price: 100,
    }));
    queueNewProducts(2000);

    const result = await importProducts(auth, rows);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.summary).toEqual({ created: 2000, updated: 0, skipped: 0, total: 2000 });
    expect(result.body.results).toHaveLength(2000);
    expect(result.body.results[1999]).toMatchObject({ row: 2000, status: 'created' });
  });

  it('respeta el limite de productos del plan starter', async () => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue('tenants', { data: { subscription_plan: 'starter' }, error: null });
    supabaseMock.__queue('product_stock', { count: 48, error: null });
    // El limite de plan se chequea DESPUES del lookup en bloque: 2 altas y 3
    // filas que se saltean sin escribir nada.
    supabaseMock.__queue(
      'products',
      { data: [], error: null },
      { data: { id: 'prod-1' }, error: null },
      { data: { id: 'prod-2' }, error: null },
    );

    const result = await importProducts(
      auth,
      Array.from({ length: 5 }, (_, i) => ({ name: `Producto ${i}`, sku: `SKU-${i}` })),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.summary.created).toBe(2);
    expect(result.body.summary.skipped).toBe(3);
    expect(result.body.results[2].error).toBe('Límite de productos alcanzado para tu plan');
  });
});

describe('importProducts: que pasa si falla en el medio del archivo', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    asOwner();
  });

  /**
   * La pregunta que guia este bloque: el import es fila por fila, sin
   * transaccion. Que hace el sistema cuando el write de la fila 437 de 2000
   * falla? La respuesta corta: las 436 anteriores quedan escritas, la 437 se
   * saltea, las 1563 siguientes se siguen importando, y la respuesta HTTP es
   * 200 con un resumen que no dice "esto salio a medias".
   *
   * Estos tests existen para que ese comportamiento sea una decision
   * documentada y no un accidente. Si alguna vez se mete una transaccion o un
   * rollback, el primer test falla y hay que ir a revisar el resto.
   */
  it('falla en la fila 437 de 2000 sin frenar el resto del import', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      name: `Producto ${i + 1}`,
      sku: `SKU-${i + 1}`,
      price: 100,
    }));
    queueNewProducts(2000, 437);

    const result = await importProducts(auth, rows);

    // 1. La API responde 200 igual: no es un error de la request.
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 2. La fila que fallo queda reportada con su numero.
    expect(result.body.results[436]).toMatchObject({
      row: 437,
      status: 'skipped',
      name: 'Producto 437',
      error: 'Error al importar la fila',
    });

    // 3. Las filas anteriores al fallo ya quedaron escritas. No hay rollback.
    expect(result.body.summary).toEqual({
      created: 1999,
      updated: 0,
      skipped: 1,
      total: 2000,
    });
    expect(result.body.results[435].status).toBe('created');

    // 4. El import sigue despues del fallo: la fila 438 tambien entra.
    expect(result.body.results[437]).toMatchObject({ row: 438, status: 'created' });
    expect(result.body.results[1999]).toMatchObject({ row: 2000, status: 'created' });

    // 5. Por eso el resultado no se puede tratar como "todo o nada": la
    //    respuesta es identica a la de un import limpio salvo por `skipped`.
  });

  it('deja rastro en el log del error real de la fila que fallo', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    queueNewProducts(3, 2);

    await importProducts(auth, [
      { name: 'Producto 1', sku: 'SKU-1' },
      { name: 'Producto 2', sku: 'SKU-2' },
      { name: 'Producto 3', sku: 'SKU-3' },
    ]);

    expect(errorSpy).toHaveBeenCalledWith(
      'importProducts fila',
      2,
      'error de base:',
      expect.stringContaining('deadlock detected'),
    );
  });

  it('el resumen distingue una importacion limpia de una a medias', async () => {
    queueNewProducts(3, 2);

    const result = await importProducts(auth, [
      { name: 'Producto 1', sku: 'SKU-1' },
      { name: 'Producto 2', sku: 'SKU-2' },
      { name: 'Producto 3', sku: 'SKU-3' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Un `skipped` > 0 es la unica senal que hoy distingue "importe todo" de
    // "importe casi todo". La UI lo tiene que mirar antes de festejar.
    expect(result.body.summary.skipped).toBe(1);
  });

  it('una excepcion inesperada en una fila no aborta el archivo entero', async () => {
    // La excepcion se inyecta por `buildStockMovement`: es el unico punto
    // dentro del lote que puede tira algo que no sea un error de la fila, y
    // reproduce el caso real de un bug de codigo (no de datos) en medio del
    // archivo. Antes esto caia en un `catch {}` sin log: la fila se perdia y
    // nadie se enteraba.
    // El id lo genera el codigo, asi que el fallo seinjecta por orden de
    // llamada: es la segunda fila del archivo la que revienta.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let llamadas = 0;
    vi.mocked(buildStockMovement).mockImplementation((p) => {
      llamadas++;
      if (llamadas === 2) throw new Error('conexion perdida');
      return {
        tenant_id: p.tenantId,
        product_id: p.productId,
        quantity: p.quantity,
        type: p.type,
        reason: p.reason,
        created_by: p.createdBy,
      };
    });

    queueNewProducts(3);

    const result = await importProducts(auth, [
      { name: 'Producto 1', sku: 'SKU-1', stock: 5 },
      { name: 'Producto 2', sku: 'SKU-2', stock: 5 },
      { name: 'Producto 3', sku: 'SKU-3', stock: 5 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.results[0].status).toBe('created');
    expect(result.body.results[1]).toMatchObject({
      row: 2,
      status: 'skipped',
      name: 'Producto 2',
      error: 'Error al importar la fila',
    });
    expect(result.body.results[2].status).toBe('created');
    expect(result.body.summary).toMatchObject({ created: 2, skipped: 1, total: 3 });
    expect(errorSpy).toHaveBeenCalledWith(
      'importProducts fila',
      2,
      'error:',
      expect.objectContaining({ message: 'conexion perdida' }),
    );
    vi.mocked(buildStockMovement).mockRestore();
  });
});

describe('importProducts: lecturas previas en bloque', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    asOwner();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resuelve los SKU en lotes de LOOKUP_CHUNK, no uno por fila', async () => {
    // Antes habia una query por fila (y hasta dos, si ademas traia codigo de
    // barras): 4000 consultas para un archivo de 2000 filas.
    const total = LOOKUP_CHUNK * 2 + 1;
    queueNewProducts(total);

    await importProducts(
      auth,
      Array.from({ length: total }, (_, i) => ({ name: `P${i}`, sku: `S-${i}` })),
    );

    const skuLookups = supabaseMock.__calls.filter(
      (c) => c.table === 'products' && c.method === 'in' && c.args[0] === 'sku',
    );
    expect(skuLookups).toHaveLength(3);
  });

  it('si falla una lectura previa no escribe nada y corta con 500', async () => {
    // El import dejo de escribir a medida que resolvia: ahora primero lee. Si
    // una lectura falla, todavia no hay nada que revertir y el archivo entero
    // se rechaza en vez de quedar a medias.
    const realFrom = supabaseMock.from;
    const fromSpy = vi.spyOn(supabaseMock, 'from').mockImplementation((table: string) => {
      if (table === 'products') throw new Error('conexion perdida');
      return realFrom(table);
    });

    const result = await importProducts(auth, [
      { name: 'Coca', sku: 'COC-1', price: 100 },
      { name: 'Pepsi', sku: 'PEP-1', price: 100 },
    ]);

    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(insertsOn('products')).toHaveLength(0);
    expect(insertsOn('product_stock')).toHaveLength(0);

    fromSpy.mockRestore();
  });
});

describe('importProducts: progreso', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    asOwner();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emite el progreso una vez por fila, arrancando en 0 y terminando en el total', async () => {
    queueNewProducts(3);
    const prepared = await prepareImport(auth, [
      { name: 'Uno', sku: 'S-1' },
      { name: 'Dos', sku: 'S-2' },
      { name: 'Tres', sku: 'S-3' },
    ]);
    if (!prepared.ok) throw new Error('prepareImport debio aceptar el archivo');

    const seen: number[] = [];
    const result = await prepared.execute((progress) => seen.push(progress.processed));

    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(3);
    expect(seen).toEqual([0, 1, 2, 3]);
    expect(result.summary).toEqual({ created: 3, updated: 0, skipped: 0, total: 3 });
  });

  it('cuenta las filas invalidas como procesadas aunque nunca lleguen a escribir', async () => {
    // Fila 1 sin nombre (se descarta en la validacion), fila 2 valida. La barra
    // no puede quedar en "1 de 2" al terminar por culpa de la fila descartada.
    queueNewProducts(1);
    const prepared = await prepareImport(auth, [{ name: '' }, { name: 'Coca', sku: 'COC-1' }]);
    if (!prepared.ok) throw new Error('prepareImport debio aceptar el archivo');

    const seen: number[] = [];
    const result = await prepared.execute((progress) => seen.push(progress.processed));

    expect(seen[0]).toBe(1);
    expect(seen[seen.length - 1]).toBe(2);
    expect(result.summary).toEqual({ created: 1, updated: 0, skipped: 1, total: 2 });
  });
});

describe('importProducts: escrituras en lote', () => {
  beforeEach(() => {
    supabaseMock.__reset();
    __resetRateLimitStateForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    asOwner();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('escribe las altas en lotes y no en tres inserts por fila', async () => {
    // El motivo de lotear: 2000 filas x 3 escrituras son 6000 round trips, que
    // es lo que hace caer el timeout de la función en un planilla grande. Con
    // `products`, `product_stock` y `stock_history` en lote, el archivo entra
    // en un tercio de las consultas.
    const total = WRITE_CHUNK * 2 + 1;
    queueNewProducts(total);

    const result = await importProducts(
      auth,
      Array.from({ length: total }, (_, i) => ({ name: `P${i}`, sku: `S-${i}`, stock: 3 })),
    );

    const lotes = Math.ceil(total / WRITE_CHUNK);
    expect(result.ok).toBe(true);
    expect(insertsOn('products')).toHaveLength(lotes);
    expect(insertsOn('product_stock')).toHaveLength(lotes);
    expect(insertsOn('stock_history')).toHaveLength(lotes);
    // Todas las filas se escribieron igual: lotear no puede perder filas.
    expect(result.ok && result.body.summary).toEqual({
      created: total,
      updated: 0,
      skipped: 0,
      total,
    });
  });

  it('da id a cada fila del lote para poder enlazar su stock', async () => {
    queueNewProducts(2);

    await importProducts(auth, [
      { name: 'Coca', sku: 'COC-1', stock: 4 },
      { name: 'Pepsi', sku: 'PEP-1', stock: 7 },
    ]);

    const stockRows = (insertsOn('product_stock')[0].args[0] ?? []) as Record<string, unknown>[];
    expect(insertedProductRows().map((row) => row.id)).toEqual(stockRows.map((row) => row.product_id));
    expect(new Set(stockRows.map((row) => row.product_id)).size).toBe(2);
  });

  it('si un lote de altas se cae, reintenta fila por fila y solo pierde esa fila', async () => {
    queueNewProducts(3, 2);

    const result = await importProducts(auth, [
      { name: 'Producto 1', sku: 'SKU-1' },
      { name: 'Producto 2', sku: 'SKU-2' },
      { name: 'Producto 3', sku: 'SKU-3' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // El error se reporta contra la fila, no contra el lote entero: el
    // reintento individual es lo que evita perder las 99 filas sanas del lote.
    expect(result.body.summary).toEqual({ created: 2, updated: 0, skipped: 1, total: 3 });
    expect(result.body.results[1]).toMatchObject({ row: 2, status: 'skipped' });
  });
});
