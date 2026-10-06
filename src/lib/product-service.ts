import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { AuthInfo } from '@/lib/api-auth';
import { createActivityLog } from '@/lib/activity-log';
import { PLAN_LIMITS, NEW_ACCOUNT_PLAN } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';
import { validatePrice, validateProduct, validateStock } from '@/lib/product-validation';
import { normalizeForSearch } from '@/lib/utils/text';
import { adjustStock, buildStockMovement } from '@/lib/stock';
import { isAllowedImagePath, pathFromLegacyPublicUrl, signProductImageUrls } from '@/lib/upload-service';
import { canManageTenant, getRoleInTenant } from '@/lib/membership-role';
import { trackEvent } from '@/lib/track-event';
import { rateLimit } from '@/lib/rate-limit';
import { MAX_IMPORT_ROWS } from '@/lib/excel-import-parse';

export type ListProductsResult =
  | { ok: true; products: Array<Record<string, unknown>> }
  | { ok: false; error: string };

export type CreateProductResult =
  | { ok: true; product: Record<string, unknown> | null }
  | { ok: false; error: string; status: 400 | 403 };

export type UpdateProductResult =
  | { ok: true; product: Record<string, unknown> }
  | { ok: false; error: string; status: 400 | 403 };

export type DeleteProductResult =
  | { ok: true }
  | { ok: false; error: string; status: 403 };

export interface ImportRowResult {
  row: number;
  status: 'created' | 'updated' | 'skipped';
  name?: string;
  error?: string;
}

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  total: number;
}

export type ImportProductsResult =
  | { ok: true; body: { results: ImportRowResult[]; summary: ImportSummary } }
  | { ok: false; error: string; status: 400 | 403 | 413 | 429 | 500 };

export type AdjustProductStockResult =
  | {
      ok: true;
      data: {
        success: boolean;
        previousStock: number;
        newStock: number;
        adjustment: number;
        reason: string;
        notes?: string;
      };
    }
  | { ok: false; error: string; status: 400 | 404 | 500 };

export type AdjustPricesResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; status: 400 | 403 | 404 | 500 };

export type CriticalProductsResult =
  | { ok: true; products: Array<Record<string, unknown>> }
  | { ok: false; error: string };

export type StockAnalysisResult =
  | { ok: true; products: Array<Record<string, unknown>> }
  | { ok: false; error: string };

export type LookupProductResult =
  | { ok: true; product: Record<string, unknown> | null }
  | { ok: false; error: string };

function sanitizeImageStoragePath(value: unknown, tenantId: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  return isAllowedImagePath(value, tenantId) ? value : null;
}

/**
 * Filtra una `image_url` que apunta al bucket propio.
 *
 * `products` es global, asi que guardar una URL del bucket de otra empresa la
 * publica para todos y `signProductImageUrls` la devuelve como signed URL
 * resuelta con la service role. Las URLs externas (CDN propio, http arbitrary)
 * no son un problema de aislamiento: solo se descartan las que viven dentro de
 * nuestro bucket bajo un folder que no es del tenant activo.
 */
function sanitizeImageUrl(value: unknown, tenantId: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  const path = pathFromLegacyPublicUrl(value);
  if (path === null) return value;
  return isAllowedImagePath(path, tenantId) ? value : null;
}

/**
 * `products` es una tabla GLOBAL (no tiene tenant_id): el scope por tenant vive
 * en `product_stock`. Eso significa que cualquier escritura sobre `products`
 * (precio, costo, SKU, nombre) es un write cross-tenant, y que el stock es lo
 * único tenant-scoped. Por eso las operaciones que tocan el catálogo global
 * exigen rol de gestión (owner/manager) en el tenant activo: un 'member' puede
 * operar su stock pero no redefinir el producto compartido.
 */
async function requireCatalogManager(
  auth: AuthInfo
): Promise<{ ok: true } | { ok: false; error: string; status: 403 }> {
  const role = await getRoleInTenant(auth.userId, auth.tenantId);
  if (!canManageTenant(role)) {
    return {
      ok: false,
      error: 'Sólo el dueño o un administrador puede modificar el catálogo de productos',
      status: 403,
    };
  }
  return { ok: true };
}

export async function listProducts(auth: AuthInfo): Promise<ListProductsResult> {
  let q = supabaseAdmin
    .from('products')
    .select(`
      *,
      stock_data:product_stock!inner(
        stock,
        min_stock,
        max_stock,
        deposito,
        pasillo,
        estanteria
      )
    `);
  if (auth.allTenants) {
    q = q.in('product_stock.tenant_id', auth.tenantIds);
  } else {
    q = q.eq('product_stock.tenant_id', auth.tenantId);
  }
  q = q.eq('product_stock.active', true);
  const { data, error } = await q;
  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.' };
  }
  const products = data?.map((p) => ({
    ...p,
    stock: p.stock_data?.[0]?.stock ?? 0,
    min_stock: p.stock_data?.[0]?.min_stock ?? 0,
    max_stock: p.stock_data?.[0]?.max_stock ?? 0,
    deposito: p.stock_data?.[0]?.deposito ?? null,
    pasillo: p.stock_data?.[0]?.pasillo ?? null,
    estanteria: p.stock_data?.[0]?.estanteria ?? null,
    stock_data: undefined,
    price: p.price_cents != null ? p.price_cents / 100 : 0,
  })) || [];
  return { ok: true, products: await signProductImageUrls(products, auth.tenantId) };
}

export async function createProduct(auth: AuthInfo, body: Record<string, unknown>): Promise<CreateProductResult> {
  // Alta en el catálogo global: sin este chequeo un 'member' podría registrar
  // SKUs/códigos de barras que colisionan con los de otro tenant (el SKU es la
  // clave con la que `importProducts` resuelve productos existentes).
  const managerCheck = await requireCatalogManager(auth);
  if (!managerCheck.ok) return managerCheck;

  const { data: tenantRow } = await supabaseAdmin
    .from('tenants')
    .select('subscription_plan')
    .eq('id', auth.tenantId)
    .single();

  const plan = (tenantRow?.subscription_plan as PlanId) || NEW_ACCOUNT_PLAN;
  const maxProducts = PLAN_LIMITS[plan]?.products ?? 50;
  if (maxProducts !== Infinity) {
    const { count } = await supabaseAdmin
      .from('product_stock')
      .select('product_id', { count: 'exact', head: true })
      .eq('tenant_id', auth.tenantId)
      .eq('active', true);
    if ((count ?? 0) >= maxProducts) {
      return {
        ok: false,
        error: `Tu plan actual (${plan}) permite hasta ${maxProducts} productos. Mejorá tu plan para seguir agregando.`,
        status: 403,
      };
    }
  }

  const allowedFields = ['category_id', 'sku', 'barcode', 'name', 'description', 'cost', 'metadata'];
  const insertData: Record<string, unknown> = {};
  if (body.price !== undefined) insertData.price_cents = Math.round(Number(body.price) * 100);
  for (const key of allowedFields) {
    if (body[key] !== undefined) insertData[key] = body[key];
  }
  const imageUrl = sanitizeImageUrl(body.image_url, auth.tenantId);
  if (imageUrl) insertData.image_url = imageUrl;
  const imageStoragePath = sanitizeImageStoragePath(body.image_storage_path, auth.tenantId);
  if (imageStoragePath) insertData.image_storage_path = imageStoragePath;

  const validationErrors = validateProduct({ name: body.name, sku: body.sku, price: body.price, stock: body.stock });
  const firstError = Object.values(validationErrors)[0];
  if (firstError) {
    return { ok: false, error: firstError, status: 400 };
  }

  const { data, error } = await supabaseAdmin
    .from('products')
    .insert(insertData)
    .select();
  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }
  const created = data?.[0];
  if (created) {
    const { error: stockError } = await supabaseAdmin
      .from('product_stock')
      .insert({
        product_id: created.id,
        tenant_id: auth.tenantId,
        stock: body.stock ?? 0,
        min_stock: body.min_stock ?? 0,
        max_stock: body.max_stock ?? 0,
        deposito: body.deposito ?? null,
        pasillo: body.pasillo ?? null,
        estanteria: body.estanteria ?? null,
      });
    if (stockError) {
      await supabaseAdmin.from('products').delete().eq('id', created.id);
      console.error('DB error:', stockError);
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'created',
      entityType: 'product',
      entityId: created.id,
      details: { name: created.name, sku: created.sku },
    });

    await trackEvent({
      type: 'product_created',
      userId: auth.userId,
      tenantId: auth.tenantId,
      metadata: { productId: created.id, name: created.name, sku: created.sku },
    });
  }
  return {
    ok: true,
    product: created
      ? {
          ...created,
          price: created.price_cents != null ? created.price_cents / 100 : 0,
          stock: body.stock ?? 0,
          min_stock: body.min_stock ?? 0,
          max_stock: body.max_stock ?? 0,
        }
      : null,
  };
}

export async function updateProduct(auth: AuthInfo, id: string, body: Record<string, unknown>): Promise<UpdateProductResult> {
  try {
    const managerCheck = await requireCatalogManager(auth);
    if (!managerCheck.ok) return managerCheck;

    const scopeTenantIds = auth.allTenants ? auth.tenantIds : [auth.tenantId];
    const { data: membership } = await supabaseAdmin
      .from('product_stock')
      .select('product_id')
      .eq('product_id', id)
      .in('tenant_id', scopeTenantIds)
      .maybeSingle();

    if (!membership) {
      return { ok: false, error: 'Producto no encontrado o sin permisos', status: 403 };
    }

    const priceError = validatePrice(body.price);
    if (priceError) return { ok: false, error: priceError, status: 400 };

    if (body.cost !== undefined && body.cost !== null && body.cost !== '') {
      const cost = Number(body.cost);
      if (Number.isNaN(cost) || cost < 0) {
        return { ok: false, error: 'El costo debe ser un número no negativo', status: 400 };
      }
    }

    for (const field of ['stock', 'min_stock', 'max_stock'] as const) {
      if (body[field] !== undefined) {
        const stockError = validateStock(body[field]);
        if (stockError) return { ok: false, error: stockError, status: 400 };
      }
    }

    const allowedFields = [
      'category_id', 'sku', 'barcode', 'name', 'description',
      'cost', 'metadata',
    ];
    const updateData: Record<string, unknown> = {};
    const hasPrice = body.price !== undefined && body.price !== null && body.price !== '';
    if (hasPrice) updateData.price_cents = Math.round(Number(body.price) * 100);
    for (const key of allowedFields) {
      if (body[key] !== undefined) updateData[key] = body[key];
    }
    if (body.image_url !== undefined) {
      const imageUrl = sanitizeImageUrl(body.image_url, auth.tenantId);
      updateData.image_url = imageUrl;
    }
    if (body.image_storage_path !== undefined) {
      const imageStoragePath = sanitizeImageStoragePath(body.image_storage_path, auth.tenantId);
      updateData.image_storage_path = imageStoragePath;
      if (!imageStoragePath && !body.image_url) updateData.image_url = null;
    }
    if (updateData.category_id === '') updateData.category_id = null;
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('products')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('DB error:', error);
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }
    if (!data) {
      return { ok: false, error: 'Producto no encontrado o sin permisos', status: 403 };
    }

    if (data && (body.stock !== undefined || body.min_stock !== undefined || body.max_stock !== undefined || body.deposito !== undefined || body.pasillo !== undefined || body.estanteria !== undefined)) {
      const stockUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.stock !== undefined) stockUpdate.stock = body.stock;
      if (body.min_stock !== undefined) stockUpdate.min_stock = body.min_stock;
      if (body.max_stock !== undefined) stockUpdate.max_stock = body.max_stock;
      if (body.deposito !== undefined) stockUpdate.deposito = body.deposito;
      if (body.pasillo !== undefined) stockUpdate.pasillo = body.pasillo;
      if (body.estanteria !== undefined) stockUpdate.estanteria = body.estanteria;

      let previousStock: number | null = null;
      if (body.stock !== undefined) {
        const { data: currentStockRow } = await supabaseAdmin
          .from('product_stock')
          .select('stock')
          .eq('product_id', id)
          .eq('tenant_id', auth.tenantId)
          .maybeSingle();
        previousStock = Number((currentStockRow as Record<string, unknown> | null)?.stock) || 0;
      }

      const { error: stockError } = await supabaseAdmin
        .from('product_stock')
        .upsert({
          product_id: id,
          tenant_id: auth.tenantId,
          ...stockUpdate,
        }, { onConflict: 'product_id,tenant_id' });

      if (stockError) {
        console.error('DB error:', stockError);
        return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
      }

      if (previousStock !== null) {
        const newStock = Number(body.stock);
        const delta = newStock - previousStock;
        if (delta !== 0) {
          const movement = buildStockMovement({
            tenantId: auth.tenantId,
            productId: id,
            quantity: delta,
            type: 'adjustment',
            reason: 'Edición de producto',
            createdBy: auth.userId,
          });
          const { error: histError } = await supabaseAdmin
            .from('stock_history')
            .insert(movement);
          if (histError) {
            console.error('stock_history insert error:', JSON.stringify(histError));
          }
        }
      }
    }

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'updated',
      entityType: 'product',
      entityId: id,
      details: { name: data?.name },
    });

    const stockData = data ? await supabaseAdmin
      .from('product_stock')
      .select('stock, min_stock, max_stock, deposito, pasillo, estanteria')
      .eq('product_id', id)
      .eq('tenant_id', auth.tenantId)
      .maybeSingle() : null;

    return {
      ok: true,
      product: {
        ...data,
        price: data.price_cents != null ? data.price_cents / 100 : 0,
        stock: stockData?.data?.stock ?? 0,
        min_stock: stockData?.data?.min_stock ?? 0,
        max_stock: stockData?.data?.max_stock ?? 0,
        deposito: stockData?.data?.deposito ?? null,
        pasillo: stockData?.data?.pasillo ?? null,
        estanteria: stockData?.data?.estanteria ?? null,
      },
    };
  } catch {
    return { ok: false, error: 'Invalid request body', status: 400 };
  }
}

export async function deleteProduct(auth: AuthInfo, id: string): Promise<DeleteProductResult> {
  const { data: stockRow, error: stockError } = await supabaseAdmin
    .from('product_stock')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('product_id', id)
    .eq('tenant_id', auth.tenantId)
    .select('id')
    .single();

  if (stockError || !stockRow) {
    return { ok: false, error: 'Producto no encontrado o sin permisos', status: 403 };
  }

  const { data: productName } = await supabaseAdmin
    .from('products')
    .select('name')
    .eq('id', id)
    .maybeSingle();

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'deleted',
    entityType: 'product',
    entityId: id,
    details: { name: productName?.name ?? null },
  });

  return { ok: true };
}

const CATEGORY_COLOR_PALETTE = [
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#22c55e',
  '#eab308', '#ef4444', '#3b82f6', '#14b8a6', '#a855f7',
  '#f43f5e', '#0ea5e9', '#84cc16', '#d946ef', '#10b981',
];

/**
 * Estado de las categorías de un import, cargado una sola vez.
 *
 * Antes cada fila hacía hasta dos queries de `categories` (una `ilike` para
 * buscar y otra para los colores), así que 2000 filas con categoría eran 4000
 * consultas. Peor: `ilike` en Postgres NO ignora acentos, así que "Almacen" y
 * "Almacén" creaban dos categorías distintas, y como `UNIQUE(tenant_id, name)`
 * también es case-sensitive, dos filas del mismo archivo con "Bebidas" y
 * "bebidas" convivían sin que el `maybeSingle()` fallara pero tampoco sin
 * fusionarse. Comparar en memoria con `normalizeForSearch` cierra los dos
 * problemas de una: sin acentos, sin case, y sin query por fila.
 */
interface CategoryResolver {
  byKey: Map<string, string>;
  usedColors: Set<string>;
}

/** Clave de comparación: sin acentos, sin mayúsculas, espacios colapsados. */
function categoryKey(name: string): string {
  return normalizeForSearch(name.trim()).replace(/\s+/g, ' ');
}

async function loadCategoryResolver(tenantId: string): Promise<CategoryResolver> {
  const { data } = await supabaseAdmin
    .from('categories')
    .select('id, name, color')
    .eq('tenant_id', tenantId);

  const byKey = new Map<string, string>();
  const usedColors = new Set<string>();
  for (const row of (Array.isArray(data) ? data : [])) {
    const key = categoryKey(String(row.name ?? ''));
    if (key && !byKey.has(key)) byKey.set(key, String(row.id));
    const color = (row as Record<string, unknown>).color;
    if (color) usedColors.add(String(color));
  }
  return { byKey, usedColors };
}

async function resolveCategory(
  tenantId: string,
  name: string,
  state: CategoryResolver
): Promise<string | null> {
  const key = categoryKey(name);
  if (!key) return null;

  const found = state.byKey.get(key);
  if (found) return found;

  const color =
    CATEGORY_COLOR_PALETTE.find((c) => !state.usedColors.has(c)) ??
    CATEGORY_COLOR_PALETTE[state.usedColors.size % CATEGORY_COLOR_PALETTE.length];

  const { data: created, error } = await supabaseAdmin
    .from('categories')
    .insert({ tenant_id: tenantId, name: name.trim(), color })
    .select('id')
    .single();

  // Se exige el id y no solo "no hubo error": una respuesta sin id (o con un
  // id no string) terminaba guardando el texto "undefined" en la FK del
  // producto, que es un error de datos silencioso y no una categoria creada.
  const createdId = created?.id;
  if (error || !createdId) {
    console.error('importProducts: no se pudo crear la categoría', name.trim(), JSON.stringify(error));
    return null;
  }
  // Se guarda en el indice para que las filas siguientes del mismo archivo
  // reutilicen la categoria en vez de crear una copia por fila.
  state.byKey.set(key, String(createdId));
  if (color) state.usedColors.add(color);
  return String(createdId);
}

const IMPORT_ALLOWED_FIELDS = ['sku', 'barcode', 'name', 'description', 'cost', 'image_url', 'metadata'];

/** Tamaño de los lotes de `.in()`: la lista viaja en el query string del request. */
export const LOOKUP_CHUNK = 200;

/** Filas por lote de escritura: una fila con 3 inserts son 6000 round trips a 2000 filas. */
export const WRITE_CHUNK = 100;
/** Fila que ya paso las validaciones y esta lista para escribirse. */
interface ValidatedRow {
  index: number;
  row: number;
  name: string;
  productData: Record<string, unknown>;
  stock: number;
  minStock: number;
  maxStock: number;
  deposito: string | null;
  pasillo: string | null;
  estanteria: string | null;
  hasStock: boolean;
  hasMinStock: boolean;
  hasMaxStock: boolean;
  hasLocation: boolean;
  categoryName: string;
}

/**
 * Busca en bloque los productos de este tenant que ya tienen alguno de los
 * valores dados y devuelve un mapa `valor -> id`.
 *
 * Antes esto era una query por fila y por campo (hasta dos por fila, o sea
 * 4000 consultas para un archivo de 2000 filas). El filtro por
 * `product_stock.tenant_id` es lo que mantiene el scope: `products` es global y
 * un SKU de otro tenant no tiene que resolver aca.
 */
async function findProductIdsByField(
  tenantId: string,
  field: 'sku' | 'barcode',
  values: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(values.filter((v) => v !== '')));
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + LOOKUP_CHUNK);
    const { data } = await supabaseAdmin
      .from('products')
      .select(`id, ${field}, product_stock!inner(tenant_id)`)
      .in(field, chunk)
      .eq('product_stock.tenant_id', tenantId);
    for (const row of Array.isArray(data) ? data : []) {
      const record = row as Record<string, unknown>;
      const key = String(record[field] ?? '');
      if (key && !map.has(key)) map.set(key, String(record.id));
    }
  }
  return map;
}

export interface ImportProgress {
  processed: number;
  total: number;
  created: number;
  updated: number;
  skipped: number;
}

export type ImportProgressCallback = (progress: ImportProgress) => void;

type ImportGuardFailure = { ok: false; error: string; status: 400 | 403 | 413 | 429 | 500 };

/**
 * Import validado y resuelto contra la base, listo para escribir.
 *
 * `prepareImport` hace todo lo que NO escribe: valida las filas, resuelve los
 * SKU/códigos existentes (en bloque) y carga el catálogo de categorías. Separar
 * esto de `execute` es lo que permite que la ruta HTTP decida el status antes de
 * empezar a streamear: si una guarda falla, todavía se puede responder un JSON
 * con 4xx/5xx en vez de un stream cortado a medias.
 */
export type PreparedImport =
  | ImportGuardFailure
  | {
      ok: true;
      total: number;
      execute: (
        onProgress?: ImportProgressCallback
      ) => Promise<{ results: ImportRowResult[]; summary: ImportSummary }>;
    };

export async function prepareImport(
  auth: AuthInfo,
  products: Record<string, unknown>[] | undefined
): Promise<PreparedImport> {
  if (!Array.isArray(products) || products.length === 0) {
    return { ok: false, error: 'No products provided', status: 400 };
  }

  // El tope vive en el servidor y no en el archivo: el cliente valida el
  // mismo numero para no gastar la maquina del usuario, pero el request llega
  // armado a mano y el limite que protege la base es este.
  if (products.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `La importación acepta hasta ${MAX_IMPORT_ROWS} filas por vez (enviaste ${products.length}).`,
      status: 413,
    };
  }

  // Cada import son miles de escrituras sobre el catalogo global. Sin este
  // limite, un bucle con el token de un owner llena la base y se lleva puesto
  // el rate limit por costo de base de datos. Se cuentan tenant y usuario como
  // en la subida de imagenes: el tenant frena el consumo agregado y el usuario
  // el reintento desde varias sesiones.
  const tenantLimit = await rateLimit(`import:tenant:${auth.tenantId}`, 30, 60 * 60 * 1000);
  if (!tenantLimit.ok) {
    return { ok: false, error: 'Límite de importaciones alcanzado. Probá de nuevo más tarde.', status: 429 };
  }
  const userLimit = await rateLimit(`import:user:${auth.userId}`, 10, 60 * 60 * 1000);
  if (!userLimit.ok) {
    return { ok: false, error: 'Límite de importaciones alcanzado. Probá de nuevo más tarde.', status: 429 };
  }

  // La importación crea filas en `products` (global) y actualiza las que ya
  // existen para este tenant: es una escritura sobre el catálogo compartido.
  const managerCheck = await requireCatalogManager(auth);
  if (!managerCheck.ok) return { ok: false, error: managerCheck.error, status: 403 };

  // Un resultado por fila, indexado por posición. Se llena a medida que cada
  // fila se resuelve (validación, límite de plan o escritura) para que
  // `results.length === products.length` siempre y el número de fila del
  // reporte siga coincidiendo con el del archivo.
  const slots: (ImportRowResult | null)[] = new Array(products.length).fill(null);

  // ── Fase 1: validar TODAS las filas sin tocar la base ────────────────────
  //
  // El import no es transaccional: no hay `db.transaction()` ni una función de
  // Postgres detrás. Lo único que se puede garantizar sin eso es que un archivo
  // con errores de datos no escriba nada: se valida todo primero y recién
  // después se escribe. Antes, un precio inválido en la fila 437 se descubría
  // con las 436 anteriores ya escritas.
  const candidates: ValidatedRow[] = [];
  for (let i = 0; i < products.length; i++) {
    const row = products[i] ?? {};
    const rowNumber = i + 1;
    const name = String(row.name ?? '');

    if (!name.trim()) {
      slots[i] = { row: rowNumber, status: 'skipped', error: 'Nombre requerido' };
      continue;
    }

    const hasPrice = row.price !== undefined && row.price !== null && row.price !== '';
    const priceError = hasPrice ? validatePrice(row.price) : null;
    if (priceError) {
      slots[i] = { row: rowNumber, status: 'skipped', name, error: priceError };
      continue;
    }

    if (row.cost !== undefined && row.cost !== null && row.cost !== '') {
      const cost = Number(row.cost);
      if (Number.isNaN(cost) || cost < 0) {
        slots[i] = { row: rowNumber, status: 'skipped', name, error: 'El costo debe ser un número no negativo' };
        continue;
      }
    }

    let stockValidationError: string | null = null;
    for (const field of ['stock', 'min_stock', 'max_stock'] as const) {
      const stockFieldError = validateStock(row[field]);
      if (stockFieldError) {
        stockValidationError = stockFieldError;
        break;
      }
    }
    if (stockValidationError) {
      slots[i] = { row: rowNumber, status: 'skipped', name, error: stockValidationError };
      continue;
    }

    const productData: Record<string, unknown> = {};
    // La API es publica y `price` puede llegar como '' o null desde cualquier
    // cliente. Sin este chequeo un precio en blanco se guardaba como
    // price_cents = 0: poner el precio del producto en cero sin que nadie lo
    // haya pedido en la planilla.
    if (hasPrice) {
      const priceValue = Number(row.price);
      if (Number.isFinite(priceValue)) productData.price_cents = Math.round(priceValue * 100);
    }
    for (const key of IMPORT_ALLOWED_FIELDS) {
      if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
        productData[key] =
          key === 'image_url' ? sanitizeImageUrl(row[key], auth.tenantId) : row[key];
      }
    }

    // Una celda de stock vacía significa "no informar", no "dejar en cero". En
    // una actualización se conserva el valor que ya tiene el producto; en un
    // alta nueva arranca en 0.
    const hasStock = row.stock !== undefined && row.stock !== null && row.stock !== '';
    const hasMinStock = row.min_stock !== undefined && row.min_stock !== null && row.min_stock !== '';
    const hasMaxStock = row.max_stock !== undefined && row.max_stock !== null && row.max_stock !== '';
    const hasLocation =
      row.deposito !== undefined || row.pasillo !== undefined || row.estanteria !== undefined;

    candidates.push({
      index: i,
      row: rowNumber,
      name,
      productData,
      stock: Number(row.stock) || 0,
      minStock: Number(row.min_stock) || 0,
      maxStock: Number(row.max_stock) || 0,
      deposito: String(row.deposito ?? '').trim() || null,
      pasillo: String(row.pasillo ?? '').trim() || null,
      estanteria: String(row.estanteria ?? '').trim() || null,
      hasStock,
      hasMinStock,
      hasMaxStock,
      hasLocation,
      categoryName: String(row.category_name ?? ''),
    });
  }

  // ── Fase 2: resolver contra la base, todo lectura ────────────────────────
  const existingBySku = new Map<string, string>();
  const existingByBarcode = new Map<string, string>();
  let categories: CategoryResolver;
  try {
    const bySku = await findProductIdsByField(
      auth.tenantId,
      'sku',
      candidates.map((c) => String(c.productData.sku ?? ''))
    );
    const byBarcode = await findProductIdsByField(
      auth.tenantId,
      'barcode',
      candidates.map((c) => String(c.productData.barcode ?? ''))
    );
    for (const [key, id] of bySku) existingBySku.set(key, id);
    for (const [key, id] of byBarcode) existingByBarcode.set(key, id);
    // Una sola lectura del catálogo de categorías para todo el archivo. Las
    // filas con categoría nueva van creando las suyas sobre este estado, así
    // que el total de queries de `categories` queda en 1 + nuevas.
    categories = await loadCategoryResolver(auth.tenantId);
  } catch (error) {
    // Si una lectura falla, todavía no se escribió nada: es el mejor momento
    // para abortar el import entero en vez de seguir a medias.
    console.error('importProducts: fallo una lectura previa', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const { data: tenantRow } = await supabaseAdmin
    .from('tenants')
    .select('subscription_plan')
    .eq('id', auth.tenantId)
    .single();

  const plan = (tenantRow?.subscription_plan as PlanId) || NEW_ACCOUNT_PLAN;
  const maxProducts = PLAN_LIMITS[plan]?.products ?? 50;
  let productCount: number | null = null;
  if (maxProducts !== Infinity) {
    const { count } = await supabaseAdmin
      .from('product_stock')
      .select('product_id', { count: 'exact', head: true })
      .eq('tenant_id', auth.tenantId)
      .eq('active', true);
    productCount = count ?? 0;
  }

  const total = products.length;

  // ── Fase 3: escribir ─────────────────────────────────────────────────────
  //
  // Los mapas de existentes se siguen actualizando acá: cuando una fila crea un
  // producto, su SKU/código queda registrado para que la próxima fila del MISMO
  // archivo con ese SKU lo actualice en vez de duplicarlo.
  //
  // `onProgress` se llama después de resolver cada fila con los contadores
  // acumulados. La ruta lo usa para streamear "X de N" al cliente. La primera
  // llamada ya incluye las filas que la Fase 1 descartó por datos inválidos,
  // que no aparecen en `candidates`.
const execute = async (onProgress?: ImportProgressCallback) => {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const slot of slots) {
      if (!slot) continue;
      if (slot.status === 'created') created++;
      else if (slot.status === 'updated') updated++;
      else skipped++;
    }
    let processed = skipped;
    const emit = () => onProgress?.({ processed, total, created, updated, skipped });

    // ── Plan: decidir qué filas son alta y cuáles actualización ─────────────
    // El id lo genera el servidor con `randomUUID()` y se anota en los mapas
    // ANTES de escribir. Así un SKU repetido dentro del mismo archivo resuelve
    // contra la fila anterior sin esperar a que la anterior esté escrita, y el
    // `products` se puede mandar en un lote sin depender del id que devuelve la
    // base (que es lo que permitía atribuir un error a una fila concreta).
    const toCreate: { candidate: ValidatedRow; id: string }[] = [];
    const toUpdate: { candidate: ValidatedRow; id: string }[] = [];

    for (const candidate of candidates) {
      if (candidate.categoryName.trim()) {
        const categoryId = await resolveCategory(auth.tenantId, candidate.categoryName, categories);
        if (categoryId) candidate.productData.category_id = categoryId;
      }

      let existingId: string | undefined;
      if (candidate.productData.sku) {
        existingId = existingBySku.get(String(candidate.productData.sku));
      }
      if (!existingId && candidate.productData.barcode) {
        existingId = existingByBarcode.get(String(candidate.productData.barcode));
      }

      if (existingId) {
        toUpdate.push({ candidate, id: existingId });
      } else if (productCount !== null && productCount >= maxProducts) {
        slots[candidate.index] = {
          row: candidate.row,
          status: 'skipped',
          name: candidate.name,
          error: 'Límite de productos alcanzado para tu plan',
        };
        skipped++;
        processed++;
      } else {
        if (productCount !== null) productCount++;
        const id = globalThis.crypto.randomUUID();
        toCreate.push({ candidate, id });
        if (candidate.productData.sku) existingBySku.set(String(candidate.productData.sku), id);
        if (candidate.productData.barcode) {
          existingByBarcode.set(String(candidate.productData.barcode), id);
        }
      }
    }

    emit();
    const now = new Date().toISOString();

    // ── Altas: productos, stock e historial en lotes ────────────────────────
    // Tres escrituras por fila son 6000 round trips para un archivo de 2000
    // filas, que es justo lo que hace caer el timeout de la función. Con el id
    // generado acá, las tres van en lote. Si un lote se cae se reintenta fila
    // por fila, para no perder el detalle de error de cada una.
    for (let start = 0; start < toCreate.length; start += WRITE_CHUNK) {
      const chunk = toCreate.slice(start, start + WRITE_CHUNK);
      const rows = chunk.map((item) => ({ id: item.id, ...item.candidate.productData }));

      let saved = chunk;
      const { error } = await supabaseAdmin.from('products').insert(rows);
      if (error) {
        saved = [];
        for (const item of chunk) {
          const { error: rowError } = await supabaseAdmin
            .from('products')
            .insert({ id: item.id, ...item.candidate.productData });
          if (rowError) {
            console.error('importProducts fila', item.candidate.row, 'error de base:', JSON.stringify(rowError));
            slots[item.candidate.index] = {
              row: item.candidate.row,
              status: 'skipped',
              name: item.candidate.name,
              error: 'Error al importar la fila',
            };
            skipped++;
            processed++;
            emit();
          } else {
            saved.push(item);
          }
        }
      }

      if (saved.length > 0) {
        const { error: stockError } = await supabaseAdmin.from('product_stock').insert(
          saved.map((item) => ({
            product_id: item.id,
            tenant_id: auth.tenantId,
            stock: item.candidate.stock,
            min_stock: item.candidate.minStock,
            max_stock: item.candidate.maxStock,
            deposito: item.candidate.deposito,
            pasillo: item.candidate.pasillo,
            estanteria: item.candidate.estanteria,
          })),
        );
        if (stockError) {
          console.error('importProducts: fallo el stock de un lote', JSON.stringify(stockError));
        }

        // Un `buildStockMovement` que tira (un bug de código, no un dato) deja
        // su fila como omitida sin frenar el resto del lote.
        const movements: ReturnType<typeof buildStockMovement>[] = [];
        const createdItems: typeof saved = [];
        for (const item of saved) {
          if (item.candidate.stock !== 0) {
            try {
              movements.push(
                buildStockMovement({
                  tenantId: auth.tenantId,
                  productId: item.id,
                  quantity: item.candidate.stock,
                  type: 'in',
                  reason: 'Importación de productos',
                  createdBy: auth.userId,
                }),
              );
            } catch (err) {
              console.error('importProducts fila', item.candidate.row, 'error:', err);
              slots[item.candidate.index] = {
                row: item.candidate.row,
                status: 'skipped',
                name: item.candidate.name,
                error: 'Error al importar la fila',
              };
              skipped++;
              processed++;
              emit();
              continue;
            }
          }
          createdItems.push(item);
        }
        if (movements.length > 0) {
          const { error: historyError } = await supabaseAdmin.from('stock_history').insert(movements);
          if (historyError) {
            console.error('importProducts: fallo el historial de un lote', JSON.stringify(historyError));
          }
        }
        saved = createdItems;
      }

      for (const item of saved) {
        slots[item.candidate.index] = {
          row: item.candidate.row,
          status: 'created',
          name: item.candidate.name,
        };
        created++;
        processed++;
        emit();
      }
    }

    // ── Actualizaciones: fila por fila ──────────────────────────────────────
    // Una actualización necesita el stock anterior de esa misma fila para
    // calcular el delta, así que este camino no se lotea: solo aparece en un
    // reimport, donde el volumen es mucho menor que el del alta inicial.
    for (const item of toUpdate) {
      const candidate = item.candidate;
      candidate.productData.updated_at = now;
      const { error } = await supabaseAdmin
        .from('products')
        .update(candidate.productData)
        .eq('id', item.id);

      if (error) {
        console.error('importProducts fila', candidate.row, 'error de base:', JSON.stringify(error));
        slots[candidate.index] = {
          row: candidate.row,
          status: 'skipped',
          name: candidate.name,
          error: 'Error al importar la fila',
        };
        skipped++;
      } else {
        const { data: prevStockRow } = await supabaseAdmin
          .from('product_stock')
          .select('stock, min_stock, max_stock')
          .eq('product_id', item.id)
          .eq('tenant_id', auth.tenantId)
          .maybeSingle();
        const prev = (prevStockRow ?? {}) as Record<string, unknown>;
        const previousStock = Number(prev.stock) || 0;

        const nextStock = candidate.hasStock ? candidate.stock : previousStock;
        const stockUpdate: Record<string, unknown> = {
          product_id: item.id,
          tenant_id: auth.tenantId,
          stock: nextStock,
          min_stock: numberOr(prev.min_stock, candidate.hasMinStock, candidate.minStock),
          max_stock: numberOr(prev.max_stock, candidate.hasMaxStock, candidate.maxStock),
          active: true,
          updated_at: now,
        };
        if (candidate.hasLocation) {
          stockUpdate.deposito = candidate.deposito;
          stockUpdate.pasillo = candidate.pasillo;
          stockUpdate.estanteria = candidate.estanteria;
        }

        await supabaseAdmin
          .from('product_stock')
          .upsert(stockUpdate, { onConflict: 'product_id,tenant_id' });

        const delta = nextStock - previousStock;
        if (delta !== 0) {
          await insertStockMovement(auth, item.id, delta, 'adjustment');
        }
        slots[candidate.index] = { row: candidate.row, status: 'updated', name: candidate.name };
        updated++;
      }
      processed++;
      emit();
    }

    const results = slots.filter((r): r is ImportRowResult => r !== null);

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'imported',
      entityType: 'import',
      details: { created, updated, skipped, total },
    });

    // Se graba aunque el import no haya creado nada (created = 0): la intención
    // de cargar catálogo en volumen es la señal que se quiere medir, y un import
    // que falla entero por formato es justamente el caso donde hace falta saber
    // que lo intentaron. Los contadores viajan en el metadata para poder separar
    // el import útil del fallido.
    await trackEvent({
      type: 'excel_import',
      userId: auth.userId,
      tenantId: auth.tenantId,
      metadata: { created, updated, skipped, total },
    });

    return { results, summary: { created, updated, skipped, total } };
  };
  return { ok: true, total, execute };
}

export async function importProducts(
  auth: AuthInfo,
  products: Record<string, unknown>[] | undefined
): Promise<ImportProductsResult> {
  const prepared = await prepareImport(auth, products);
  if (!prepared.ok) return prepared;
  const body = await prepared.execute();
  return { ok: true, body };
}

/** Devuelve el valor nuevo si la fila lo traía, o el que ya tenía el producto. */
function numberOr(previous: unknown, hasNew: boolean, next: number): number {
  return hasNew ? next : Number(previous) || 0;
}

async function insertStockMovement(
  auth: AuthInfo,
  productId: string,
  quantity: number,
  type: 'in' | 'adjustment'
): Promise<void> {
  const movement = buildStockMovement({
    tenantId: auth.tenantId,
    productId,
    quantity,
    type,
    reason: 'Importación de productos',
    createdBy: auth.userId,
  });
  const { error } = await supabaseAdmin.from('stock_history').insert(movement);
  if (error) {
    console.error('stock_history insert error:', JSON.stringify(error));
  }
}

export async function adjustProductStock(auth: AuthInfo, id: string, body: {
  quantity?: unknown;
  reason?: unknown;
  notes?: unknown;
}): Promise<AdjustProductStockResult> {
  const { quantity, reason, notes } = body as {
    quantity: number;
    reason: 'damaged' | 'lost' | 'stolen' | 'expired' | 'found' | 'correction';
    notes?: string;
  };

  if (!quantity || typeof quantity !== 'number') {
    return { ok: false, error: 'La cantidad es requerida', status: 400 };
  }

  if (!reason) {
    return { ok: false, error: 'El motivo es requerido', status: 400 };
  }

  const { data: product, error: prodError } = await supabaseAdmin
    .from('products')
    .select('id, name')
    .eq('id', id)
    .single();

  if (prodError || !product) {
    return { ok: false, error: 'Producto no encontrado', status: 404 };
  }

  const { data: stockRow } = await supabaseAdmin
    .from('product_stock')
    .select('stock')
    .eq('product_id', id)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle();

  // Si el producto no está en el tenant del usuario, el UPDATE posterior no
  // matchearía ninguna fila: sin este chequeo devolvíamos "éxito" sin haber
  // ajustado nada y dejábamos un movimiento de stock huérfano en el historial.
  if (!stockRow) {
    return { ok: false, error: 'Producto no encontrado en tu sucursal', status: 404 };
  }

  const currentStock = Number((stockRow as Record<string, unknown> | null)?.stock) || 0;
  // Fail-fast con el mismo criterio que el UPDATE atomico: le da al cajero una
  // respuesta SIN escribir nada. El caso residual (que otro ajuste haya movido
  // el stock entre esta lectura y el write) lo cubre la RPC.
  const result = adjustStock(currentStock, quantity);
  if (!result.ok) {
    return { ok: false, error: result.error, status: 400 };
  }

  // Ajuste, chequeo de no-negativo y movimiento de historial en UNA transaccion
  // (migracion 049). El `stock + quantity >= 0` se evalua bajo el lock de fila:
  // dos ajustes concurrentes ya no escriben sobre el mismo valor leido, y el
  // `stock_history` no puede faltar si el stock cambio.
  const { data, error: rpcError } = await supabaseAdmin.rpc('adjust_stock_atomic', {
    p_product_id: id,
    p_tenant_id: auth.tenantId,
    p_quantity: quantity,
    p_reason: `${reason}${notes ? ': ' + notes : ''}`,
    p_created_by: auth.userId,
  });

  if (rpcError) {
    console.error('adjust_stock_atomic fallo:', rpcError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const outcome = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!outcome?.ok) {
    // `old_stock` NULL (y ok=false) es la senal de "no hay fila para este
    // tenant": la unica forma de llegar aca con una carrera es que el stock se
    // haya movido tanto que este ajuste ya no alcanza.
    if (outcome?.old_stock == null) {
      return { ok: false, error: 'Producto no encontrado en tu sucursal', status: 404 };
    }
    return { ok: false, error: 'El stock no puede ser negativo', status: 400 };
  }

  const newStock = Number(outcome.new_stock) ?? 0;

  return {
    ok: true,
    data: {
      success: true,
      previousStock: newStock - quantity,
      newStock,
      adjustment: quantity,
      reason,
      notes,
    },
  };
}

export async function adjustPrices(auth: AuthInfo, body: {
  percentage?: unknown;
  product_ids?: unknown;
  category_id?: unknown;
}): Promise<AdjustPricesResult> {
  const { percentage, product_ids, category_id } = body as {
    percentage: number;
    product_ids?: string[];
    category_id?: string | null;
  };
  const tenantId = auth.tenantId;

  // Recalcula precio y costo sobre la fila GLOBAL de `products`: el efecto cae
  // sobre todos los tenants que usan esos productos, así que exige rol de
  // gestión y acota el porcentaje para que un member no dispare el catálogo.
  const managerCheck = await requireCatalogManager(auth);
  if (!managerCheck.ok) return managerCheck;

  if (percentage === undefined || typeof percentage !== 'number' || percentage <= 0 || percentage > 100) {
    return { ok: false, error: 'Porcentaje inválido (debe estar entre 0 y 100)', status: 400 };
  }

  const multiplier = 1 + percentage / 100;

  const scopeTenantIds = auth.allTenants ? auth.tenantIds : [tenantId];
  const { data: stockRows, error: stockError } = await supabaseAdmin
    .from('product_stock')
    .select('product_id')
    .in('tenant_id', scopeTenantIds);

  if (stockError) {
    console.error('DB error:', stockError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const tenantProductIds = new Set((stockRows ?? []).map((row) => row.product_id as string));
  const allowedIds = product_ids && product_ids.length > 0
    ? product_ids.filter((id) => tenantProductIds.has(id))
    : Array.from(tenantProductIds);

  if (allowedIds.length === 0) {
    return { ok: false, error: 'No hay productos', status: 404 };
  }

  let productsQuery = supabaseAdmin
    .from('products')
    .select('id, name, price_cents, cost, category_id')
    .in('id', allowedIds);

  if (category_id) {
    productsQuery = productsQuery.eq('category_id', category_id);
  }

  const { data: products, error: fetchError } = await productsQuery;

  if (fetchError) {
    console.error('DB error:', fetchError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }
  if (!products || products.length === 0) {
    return { ok: false, error: 'No hay productos', status: 404 };
  }

  const updates = products.map((p) => ({
    id: p.id,
    name: p.name,
    old_price_cents: p.price_cents,
    new_price_cents: Math.round(p.price_cents * multiplier),
    old_cost: p.cost,
    new_cost: p.cost ? Math.round(p.cost * multiplier) : null,
  }));

  const errors: { id: string; name: string; error: string }[] = [];

  for (const update of updates) {
    const updateData: Record<string, unknown> = {
      price_cents: update.new_price_cents,
      updated_at: new Date().toISOString(),
    };
    if (update.new_cost !== null) updateData.cost = update.new_cost;

    const { error: updateError } = await supabaseAdmin
      .from('products')
      .update(updateData)
      .eq('id', update.id)
      .in('id', allowedIds);

    if (updateError) {
      errors.push({ id: update.id, name: update.name, error: 'Error al aplicar el precio' });
    }
  }

  await createActivityLog({
    tenantId,
    userId: auth.userId,
    action: 'adjusted',
    entityType: 'product',
    details: { percentage, total: updates.length, updated: updates.length - errors.length, category_id: category_id ?? null },
  });

  return {
    ok: true,
    data: {
      success: errors.length === 0,
      percentage,
      total: updates.length,
      updated: updates.length - errors.length,
      errors: errors.length > 0 ? errors : undefined,
      sample: updates.slice(0, 5),
    },
  };
}

export async function getCriticalProducts(auth: AuthInfo): Promise<CriticalProductsResult> {
  try {
    const tenantId = auth.tenantId;

    let productsQuery = supabaseAdmin
      .from('products')
      .select(`
        id, name,
        stock_data:product_stock!inner(stock, min_stock)
      `);
    if (auth.allTenants) productsQuery = productsQuery.in('product_stock.tenant_id', auth.tenantIds);
    else productsQuery = productsQuery.eq('product_stock.tenant_id', tenantId);
    productsQuery = productsQuery.eq('product_stock.active', true);
    const { data: products, error } = await productsQuery;

    if (error) {
      console.error('DB error:', error);
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.' };
    }

    const critical = (products ?? []).filter((p) => {
      const s = p.stock_data?.[0];
      if (!s) return false;
      const stock = Number(s.stock) || 0;
      const minStock = Number(s.min_stock) || 0;
      return stock <= minStock;
    }).map((p) => ({
      id: p.id,
      name: p.name,
      stock: Number(p.stock_data?.[0]?.stock) || 0,
      min_stock: Number(p.stock_data?.[0]?.min_stock) || 0,
    }));

    return { ok: true, products: critical };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in critical products';
    return { ok: false, error: msg };
  }
}

export async function getStockAnalysis(auth: AuthInfo): Promise<StockAnalysisResult> {
  try {
    const tenantId = auth.tenantId;

    let productsQ = supabaseAdmin
      .from('products')
      .select(`
        id, name, sku,
        stock_data:product_stock!inner(stock, min_stock)
      `);
    if (auth.allTenants) productsQ = productsQ.in('product_stock.tenant_id', auth.tenantIds);
    else productsQ = productsQ.eq('product_stock.tenant_id', tenantId);
    productsQ = productsQ.eq('product_stock.active', true);
    const { data: allProducts } = await productsQ;

    const criticalProducts = (allProducts ?? [])
      .filter((p) => {
        const s = p.stock_data?.[0];
        if (!s) return false;
        const stock = Number(s?.stock) || 0;
        const minStock = Number(s?.min_stock) || 0;
        return stock <= minStock;
      })
      .slice(0, 15)
      .map((p) => ({
        ...p,
        stock: Number(p.stock_data?.[0]?.stock) || 0,
        min_stock: Number(p.stock_data?.[0]?.min_stock) || 0,
        stock_data: undefined,
      }));

    if (!criticalProducts || criticalProducts.length === 0) {
      return { ok: true, products: [] };
    }

    const productIds = criticalProducts.map((p) => p.id as string);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let recentSalesQ = supabaseAdmin
      .from('sales')
      .select('id, created_at')
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(100);
    if (auth.allTenants) recentSalesQ = recentSalesQ.in('tenant_id', auth.tenantIds);
    else recentSalesQ = recentSalesQ.eq('tenant_id', tenantId);
    const { data: recentSales } = await recentSalesQ;

    const recentSaleIds = (recentSales ?? []).map((s) => s.id as string);
    const saleDateMap: Record<string, string> = {};
    for (const s of (recentSales ?? [])) {
      saleDateMap[s.id as string] = s.created_at as string;
    }

    const { data: saleItems } = recentSaleIds.length > 0
      ? await supabaseAdmin
          .from('sale_items')
          .select('product_id, quantity, sale_id')
          .in('product_id', productIds)
          .in('sale_id', recentSaleIds)
      : { data: [] };

    const productSales: Record<string, { totalQty: number; lastSale: string | null; weeklyAvg: number; daysLeft: number }> = {};

    for (const pid of productIds) {
      const items = (saleItems ?? []).filter((si) => (si.product_id as string) === pid);
      const totalQty = items.reduce((sum, i) => sum + ((i.quantity as number) || 0), 0);
      const dates = items.map((i) => saleDateMap[i.sale_id as string]).filter(Boolean).sort().reverse();
      const lastSale = dates.length > 0 ? dates[0] : null;
      const weeklyAvg = totalQty / 4;
      const product = criticalProducts.find((p) => (p.id as string) === pid);
      const currentStock = (product?.stock as number) || 0;
      const daysLeft = weeklyAvg > 0 ? Math.round((currentStock / weeklyAvg) * 7) : Infinity;

      productSales[pid] = { totalQty, lastSale, weeklyAvg, daysLeft };
    }

    const enriched = criticalProducts.map((p) => {
      const stats = productSales[p.id as string] || { totalQty: 0, lastSale: null, weeklyAvg: 0, daysLeft: Infinity };
      const stock = (p.stock as number) || 0;
      const minStock = (p.min_stock as number) || 0;

      let suggestedAction: string;
      if (stock === 0) {
        suggestedAction = 'Reposición urgente sin stock.';
      } else if (stats.daysLeft <= 3) {
        suggestedAction = 'Comprar esta semana antes del viernes.';
      } else if (stats.daysLeft <= 7) {
        suggestedAction = 'Planificar compra para los próximos días.';
      } else {
        suggestedAction = 'Monitorear y reponer pronto.';
      }

      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        stock,
        min_stock: minStock,
        lastSale: stats.lastSale,
        weeklyAvg: Math.round(stats.weeklyAvg * 10) / 10,
        daysLeft: stats.daysLeft === Infinity ? null : stats.daysLeft,
        suggestedAction,
      };
    });

    enriched.sort((a, b) => {
      if (a.stock === 0 && b.stock !== 0) return -1;
      if (b.stock === 0 && a.stock !== 0) return 1;
      return (a.daysLeft ?? 999) - (b.daysLeft ?? 999);
    });

    return { ok: true, products: enriched };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error in stock analysis';
    return { ok: false, error: msg };
  }
}

export async function lookupProductByCode(auth: AuthInfo, code: string): Promise<LookupProductResult> {
  const lookupByBarcode = async () => {
    return supabaseAdmin
      .from('products')
      .select('*')
      .eq('barcode', code)
      .maybeSingle();
  };

  const lookupById = async () => {
    return supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', code)
      .maybeSingle();
  };

  let { data, error } = await lookupByBarcode();
  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.' };
  }
  if (!data) {
    const result = await lookupById();
    data = result.data;
    error = result.error;
    if (error) {
      console.error('DB error:', error);
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.' };
    }
  }

  if (!data) {
    return { ok: true, product: null };
  }

  const { data: stockData } = await supabaseAdmin
    .from('product_stock')
    .select('stock, min_stock, max_stock, active')
    .eq('product_id', data.id)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle();

  // `products` es un catalogo global: la fila existe para toda la aplicacion
  // apenas hay stock en *alguna* empresa. Lo que decide si A puede verla es la
  // fila de `product_stock` de A. Sin ella, este producto no fue adoptado por
  // A y devolverlo filtraria nombre, precio y costo de otra empresa.
  if (!stockData || stockData.active === false) {
    return { ok: true, product: null };
  }

  return {
    ok: true,
    product: {
      ...data,
      price: data.price_cents != null ? data.price_cents / 100 : 0,
      stock: stockData.stock ?? 0,
      min_stock: stockData.min_stock ?? 0,
      max_stock: stockData.max_stock ?? 0,
    },
  };
}