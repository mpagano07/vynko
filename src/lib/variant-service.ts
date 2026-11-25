import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { AuthInfo } from '@/lib/api-auth';
import { getRoleInTenant, hasCapability } from '@/lib/membership-role';
import { validatePrice, validateStock } from '@/lib/product-validation';
import { adjustStock } from '@/lib/stock';
import { logger } from '@/lib/logger';
import { createActivityLog } from '@/lib/activity-log';
import { selectAllRows } from '@/lib/supabase-paging';
import { readVariantStockCap, variantStockCapError } from '@/lib/variant-stock-cap';
import {
  sellableDisplayName,
  toSellableItem,
  type ProductAttribute,
  type ProductAttributeValue,
  type ProductVariant,
  type SellableItem,
} from '@/lib/types/variant';

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; status: 400 | 403 | 404 | 500 };

function scopedTenantIds(auth: AuthInfo): string[] {
  return auth.allTenants ? auth.tenantIds : [auth.tenantId];
}

async function requireCapability(
  auth: AuthInfo,
  capability: 'manage_catalog' | 'manage_stock',
  message: string
): Promise<{ ok: true } | { ok: false; error: string; status: 403 }> {
  const role = await getRoleInTenant(auth.userId, auth.tenantId);
  if (!hasCapability(role, capability)) return { ok: false, error: message, status: 403 };
  return { ok: true };
}

const requireCatalogManager = (auth: AuthInfo) =>
  requireCapability(auth, 'manage_catalog', 'Sólo el dueño, un administrador o un encargado de depósito puede modificar el catálogo de productos');

const requireStockManager = (auth: AuthInfo) =>
  requireCapability(auth, 'manage_stock', 'No tenés permisos para modificar el stock de esta sucursal');

function centsToPrice(value: unknown): number {
  const cents = Number(value ?? 0);
  return Number.isFinite(cents) ? cents / 100 : 0;
}

function priceToCents(value: unknown): number {
  return Math.round(Number(value) * 100);
}

/** Atributos globales con sus valores, para el configurador del producto. */
export async function listAttributes(): Promise<ActionResult<ProductAttribute[]>> {
  const { data, error } = await supabaseAdmin
    .from('product_attributes')
    .select('id, name, product_attribute_values(id, attribute_id, value)')
    .order('name', { ascending: true });
  if (error) {
    logger.error('DB error:', { error });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }
  const attributes = (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    values: ((row.product_attribute_values ?? []) as Array<Record<string, unknown>>)
      .map((v) => ({
        id: String(v.id),
        attribute_id: String(v.attribute_id),
        value: String(v.value),
      }))
      .sort((a, b) => a.value.localeCompare(b.value, 'es')),
  }));
  return { ok: true, data: attributes };
}

export async function createAttribute(
  auth: AuthInfo,
  name: string,
  values: string[]
): Promise<ActionResult<ProductAttribute>> {
  const check = await requireCatalogManager(auth);
  if (!check.ok) return check;

  const cleanName = String(name ?? '').trim();
  const cleanValues = Array.from(new Set((values ?? []).map((v) => String(v).trim()).filter(Boolean)));
  if (!cleanName || cleanValues.length === 0) {
    return { ok: false, error: 'El atributo necesita un nombre y al menos un valor', status: 400 };
  }

  // El nombre es global y UNIQUE: upsert por nombre para que dos sucursales
  // configuredo el mismo atributo no compitan por el id.
  const { data: attribute, error } = await supabaseAdmin
    .from('product_attributes')
    .upsert({ name: cleanName, updated_at: new Date().toISOString() }, { onConflict: 'name' })
    .select('id, name')
    .single();
  if (error || !attribute?.id) {
    logger.error('DB error:', { error });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  if (cleanValues.length > 0) {
    const { error: valuesError } = await supabaseAdmin
      .from('product_attribute_values')
      .upsert(
        cleanValues.map((value) => ({ attribute_id: String(attribute.id), value })),
        { onConflict: 'attribute_id,value', ignoreDuplicates: true }
      );
    if (valuesError) {
      logger.error('DB error:', { error: valuesError });
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
    }
  }

  const { data: savedValues } = await supabaseAdmin
    .from('product_attribute_values')
    .select('id, attribute_id, value')
    .eq('attribute_id', String(attribute.id));
  return {
    ok: true,
    data: {
      id: String(attribute.id),
      name: String(attribute.name),
      values: (savedValues ?? []).map((v) => ({
        id: String(v.id),
        attribute_id: String(v.attribute_id),
        value: String(v.value),
      })),
    },
  };
}

export async function addAttributeValue(
  auth: AuthInfo,
  attributeId: string,
  value: string
): Promise<ActionResult<ProductAttributeValue>> {
  const check = await requireCatalogManager(auth);
  if (!check.ok) return check;
  const clean = String(value ?? '').trim();
  if (!clean) return { ok: false, error: 'El valor no puede estar vacío', status: 400 };

  const { data, error } = await supabaseAdmin
    .from('product_attribute_values')
    .upsert({ attribute_id: attributeId, value: clean }, { onConflict: 'attribute_id,value', ignoreDuplicates: true })
    .select('id, attribute_id, value')
    .single();
  if (error || !data?.id) {
    logger.error('DB error:', { error });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }
  return {
    ok: true,
    data: { id: String(data.id), attribute_id: String(data.attribute_id), value: String(data.value) },
  };
}

/** Variantes de un producto con el stock del tenant (o de los tenants del consolidado). */
export async function listVariants(
  auth: AuthInfo,
  productId: string
): Promise<ActionResult<ProductVariant[]>> {
  const { data: variants, error } = await supabaseAdmin
    .from('product_variants')
    .select(`
      id, product_id, sku, barcode, label, price_cents, cost, active,
      product_variant_values(value_id),
      variant_stock!inner(stock, min_stock, max_stock, active, deposito, pasillo, estanteria, category_id, tenant_id)
    `)
    .eq('product_id', productId);
  if (error) {
    logger.error('DB error:', { error });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const ids = scopedTenantIds(auth);
  const rows = (variants ?? []).map((row) => {
    const stocks = (row.variant_stock ?? []) as Array<Record<string, unknown>>;
    const own = ids.length === 1
      ? stocks.filter((s) => String(s.tenant_id) === ids[0])
      : stocks.filter((s) => ids.includes(String(s.tenant_id)));
    const totals = own.reduce<{ stock: number; min_stock: number; max_stock: number }>(
      (acc, s) => ({
        stock: acc.stock + (Number(s.stock) || 0),
        min_stock: acc.min_stock + (Number(s.min_stock) || 0),
        max_stock: acc.max_stock + (Number(s.max_stock) || 0),
      }),
      { stock: 0, min_stock: 0, max_stock: 0 }
    );
    return {
      id: String(row.id),
      product_id: String(row.product_id),
      sku: String(row.sku ?? ''),
      barcode: (row.barcode ?? null) as string | null,
      label: String(row.label ?? ''),
      price: centsToPrice(row.price_cents),
      cost: row.cost == null ? null : Number(row.cost),
      active: own.some((s) => Boolean(s.active)),
      valueIds: ((row.product_variant_values ?? []) as Array<Record<string, unknown>>).map((v) => String(v.value_id)),
      values: [],
      ...totals,
      deposito: (own[0]?.deposito ?? null) as string | null,
      pasillo: (own[0]?.pasillo ?? null) as string | null,
      estanteria: (own[0]?.estanteria ?? null) as string | null,
      category_id: (own[0]?.category_id ?? null) as string | null,
    } satisfies ProductVariant;
  });

  const valueIds = Array.from(new Set(rows.flatMap((v) => v.valueIds ?? [])));
  let valuesById = new Map<string, ProductAttributeValue>();
  if (valueIds.length > 0) {
    const { data: values } = await supabaseAdmin
      .from('product_attribute_values')
      .select('id, attribute_id, value')
      .in('id', valueIds);
    valuesById = new Map(
      (values ?? []).map((v) => [String(v.id), {
        id: String(v.id), attribute_id: String(v.attribute_id), value: String(v.value),
      }])
    );
  }
  return { ok: true, data: rows.map((v) => ({ ...v, values: (v.valueIds ?? []).map((id) => valuesById.get(id)).filter(Boolean) as ProductAttributeValue[] })) };
}

export interface VariantInput {
  sku?: unknown;
  barcode?: unknown;
  label?: unknown;
  price?: unknown;
  cost?: unknown;
  valueIds?: unknown;
  stock?: unknown;
  min_stock?: unknown;
  max_stock?: unknown;
  deposito?: unknown;
  pasillo?: unknown;
  estanteria?: unknown;
  category_id?: unknown;
  active?: unknown;
}

function normalizeVariantInput(body: VariantInput): {
  sku: string; barcode: string; label: string; priceCents: number; cost: number | null;
  valueIds: string[]; stock: number; minStock: number; maxStock: number;
  deposito: string | null; pasillo: string | null; estanteria: string | null;
  categoryId: string | null; active: boolean;
} | { error: string } {
  const priceError = validatePrice(body.price);
  if (priceError) return { error: priceError };
  for (const field of ['stock', 'min_stock', 'max_stock'] as const) {
    if (body[field] !== undefined) {
      const error = validateStock(body[field]);
      if (error) return { error };
    }
  }
  const label = String(body.label ?? '').trim();
  if (!label) return { error: 'La etiqueta de la variante es requerida' };
  const valueIds = Array.isArray(body.valueIds) ? body.valueIds.map(String) : [];
  if (valueIds.length === 0) return { error: 'La variante debe tener al menos un valor de atributo' };
  const cost = body.cost === '' || body.cost === undefined || body.cost === null ? null : Number(body.cost);
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
    return { error: 'El costo debe ser un número no negativo' };
  }
  return {
    sku: String(body.sku ?? ''),
    barcode: String(body.barcode ?? ''),
    label,
    priceCents: priceToCents(body.price),
    cost,
    valueIds,
    stock: Number(body.stock ?? 0) || 0,
    minStock: Number(body.min_stock ?? 0) || 0,
    maxStock: Number(body.max_stock ?? 0) || 0,
    deposito: body.deposito ? String(body.deposito) : null,
    pasillo: body.pasillo ? String(body.pasillo) : null,
    estanteria: body.estanteria ? String(body.estanteria) : null,
    categoryId: body.category_id ? String(body.category_id) : null,
    active: body.active === undefined ? true : Boolean(body.active),
  };
}

export async function createVariant(
  auth: AuthInfo,
  productId: string,
  body: VariantInput
): Promise<ActionResult<ProductVariant>> {
  const check = await requireCatalogManager(auth);
  if (!check.ok) return check;
  const input = normalizeVariantInput(body);
  if ('error' in input) return { ok: false, error: input.error, status: 400 };

  const cap = await readVariantStockCap(productId, auth.tenantId);
  if ('error' in cap) return { ok: false, error: cap.error, status: 500 };
  if (cap.cap !== null && cap.total + input.stock > cap.cap) {
    return { ok: false, error: variantStockCapError(cap.cap, cap.total + input.stock), status: 400 };
  }

  const { data, error } = await supabaseAdmin.rpc('create_product_variant', {
    p_product_id: productId,
    p_tenant_id: auth.tenantId,
    p_by: auth.userId,
    p_sku: input.sku,
    p_barcode: input.barcode,
    p_label: input.label,
    p_price_cents: input.priceCents,
    p_cost: input.cost,
    p_value_ids: input.valueIds,
    p_stock: input.stock,
    p_min_stock: input.minStock,
    p_max_stock: input.maxStock,
    p_deposito: input.deposito,
    p_pasillo: input.pasillo,
    p_estanteria: input.estanteria,
    p_category_id: input.categoryId,
  });
  if (error) {
    logger.error('create_product_variant fallo:', { error });
    const message = error.message?.includes('duplicate_sellable_code')
      ? 'El SKU o código de barras ya lo usa otro artículo de esta sucursal'
      : error.message?.includes('product_not_in_tenant')
        ? 'Producto no encontrado en tu sucursal'
        : 'Ocurrio un error inesperado. Intenta de nuevo.';
    return { ok: false, error: message, status: 400 };
  }
  const row = (Array.isArray(data) ? data?.[0] : data) as Record<string, unknown> | null;

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'created',
    entityType: 'product_variant',
    entityId: String(row?.id ?? ''),
    details: { product_id: productId, label: input.label, sku: input.sku },
  });

  return {
    ok: true,
    data: {
      id: String(row?.id ?? ''),
      product_id: productId,
      sku: input.sku,
      barcode: input.barcode || null,
      label: input.label,
      price: input.priceCents / 100,
      cost: input.cost,
      active: true,
      valueIds: input.valueIds,
      values: [],
      stock: input.stock,
      min_stock: input.minStock,
      max_stock: input.maxStock,
    },
  };
}

export async function updateVariant(
  auth: AuthInfo,
  variantId: string,
  body: VariantInput
): Promise<ActionResult<ProductVariant>> {
  const check = await requireCatalogManager(auth);
  if (!check.ok) return check;
  const input = normalizeVariantInput(body);
  if ('error' in input) return { ok: false, error: input.error, status: 400 };

  // `update_product_variant` no mueve stock (ver 074_product_variants.sql).
  // El formulario de edición manda el stock final, así que lo comparamos con el
  // actual y mandamos sólo la diferencia a `adjust_variant_stock_atomic`, igual
  // que hace el import. Así se preserva el historial de movimientos.
  let stockDelta = 0;
  let previousStock: number | null = null;
  if (body.stock !== undefined) {
    const { data: stockRow } = await supabaseAdmin
      .from('variant_stock')
      .select('stock')
      .eq('variant_id', variantId)
      .eq('tenant_id', auth.tenantId)
      .maybeSingle();
    if (!stockRow) return { ok: false, error: 'Variante no encontrada en tu sucursal', status: 404 };
    previousStock = Number(stockRow.stock) || 0;
    stockDelta = input.stock - previousStock;

    // El stock del padre es el tope del total de sus variantes. La suma actual
    // ya incluye esta variante, por eso se descuenta su valor anterior.
    const { data: variantRow } = await supabaseAdmin
      .from('product_variants')
      .select('product_id')
      .eq('id', variantId)
      .maybeSingle();
    if (variantRow) {
      const cap = await readVariantStockCap(String(variantRow.product_id), auth.tenantId);
      if ('error' in cap) return { ok: false, error: cap.error, status: 500 };
      const candidateTotal = cap.total - previousStock + input.stock;
      if (cap.cap !== null && candidateTotal > cap.cap) {
        return { ok: false, error: variantStockCapError(cap.cap, candidateTotal), status: 400 };
      }
    }

    if (stockDelta !== 0) {
      const stockCheck = await requireStockManager(auth);
      if (!stockCheck.ok) return stockCheck;
    }
  }

  const { data, error } = await supabaseAdmin.rpc('update_product_variant', {
    p_variant_id: variantId,
    p_tenant_id: auth.tenantId,
    p_sku: input.sku,
    p_barcode: input.barcode,
    p_label: input.label,
    p_price_cents: input.priceCents,
    p_cost: input.cost,
    p_active: input.active,
    p_value_ids: input.valueIds,
  });
  if (error) {
    logger.error('update_product_variant fallo:', { error });
    const message = error.message?.includes('duplicate_sellable_code')
      ? 'El SKU o código de barras ya lo usa otro artículo de esta sucursal'
      : 'Ocurrio un error inesperado. Intenta de nuevo.';
    return { ok: false, error: message, status: 400 };
  }
  const row = (Array.isArray(data) ? data?.[0] : data) as Record<string, unknown> | null;
  if (!row) return { ok: false, error: 'Variante no encontrada en tu sucursal', status: 404 };

  let stock = previousStock;
  if (stockDelta !== 0) {
    const adjusted = await adjustVariantStock(
      auth,
      variantId,
      stockDelta,
      'Edición de variante',
      `Stock fijado en ${input.stock}`
    );
    if (!adjusted.ok) return adjusted;
    stock = adjusted.data.newStock;
  }

  // `update_product_variant` sólo toca la fila global (códigos, precio, etc.) y
  // el flag `active` de `variant_stock`. La ubicación y la categoría son
  // específicas de la sucursal, así que se escriben acá. Sólo si el caller las
  // mandó: un PATCH parcial no debe borrarlas.
  const updatesLocation = (['deposito', 'pasillo', 'estanteria', 'category_id'] as const)
    .some((field) => body[field] !== undefined);
  if (updatesLocation) {
    const { error: stockError } = await supabaseAdmin
      .from('variant_stock')
      .update({
        deposito: input.deposito,
        pasillo: input.pasillo,
        estanteria: input.estanteria,
        category_id: input.categoryId,
        updated_at: new Date().toISOString(),
      })
      .eq('variant_id', variantId)
      .eq('tenant_id', auth.tenantId);
    if (stockError) {
      logger.error('update variant_stock (ubicación) fallo:', { error: stockError });
      return { ok: false, error: 'No se pudo guardar la ubicación de la variante', status: 500 };
    }
  }

  return {
    ok: true,
    data: {
      id: String(row.id),
      product_id: String(row.product_id),
      sku: String(row.sku ?? ''),
      barcode: (row.barcode ?? null) as string | null,
      label: String(row.label ?? ''),
      price: centsToPrice(row.price_cents),
      cost: row.cost == null ? null : Number(row.cost),
      active: input.active,
      valueIds: input.valueIds,
      values: [],
      ...(stock === null ? {} : { stock }),
      ...(updatesLocation ? {
        deposito: input.deposito,
        pasillo: input.pasillo,
        estanteria: input.estanteria,
        category_id: input.categoryId,
      } : {}),
    },
  };
}

/** Alta/baja por sucursal. No borra la variante ni su historial. */
export async function setVariantActive(
  auth: AuthInfo,
  variantId: string,
  active: boolean
): Promise<ActionResult<{ ok: true }>> {
  const check = await requireStockManager(auth);
  if (!check.ok) return check;
  const { data, error } = await supabaseAdmin
    .from('variant_stock')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('variant_id', variantId)
    .eq('tenant_id', auth.tenantId)
    .select('id')
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: 'Variante no encontrada en tu sucursal', status: 404 };
  }
  return { ok: true, data: { ok: true } };
}

/**
 * Baja definitiva en la sucursal: borra `variant_stock` y los códigos, pero no
 * la fila global de `product_variants` (es la que sostiene el historial y la
 * que pueden compartir otras sucursales). La RPC lo hace en una transacción.
 */
export async function deleteVariant(
  auth: AuthInfo,
  variantId: string
): Promise<ActionResult<{ label: string }>> {
  const check = await requireStockManager(auth);
  if (!check.ok) return check;

  const { data, error } = await supabaseAdmin.rpc('delete_product_variant', {
    p_variant_id: variantId,
    p_tenant_id: auth.tenantId,
  });
  if (error) {
    logger.error('delete_product_variant fallo:', { error });
    // postgREST devuelve PGRST202 cuando la funcion todavia no se aplico: sin
    // este caso el usuario solo ve un "error inesperado" que no dice qué hacer.
    if (error.code === 'PGRST202' || error.message?.includes('Could not find the function')) {
      return {
        ok: false,
        error: 'Falta aplicar la migración 076_delete_product_variant.sql en la base de datos',
        status: 500,
      };
    }
    if (error.message?.includes('variant_in_use')) {
      return {
        ok: false,
        error: 'La variante está en una transferencia o compra pendiente: desactivála en vez de eliminarla',
        status: 400,
      };
    }
    if (error.message?.includes('variant_not_in_tenant')) {
      return { ok: false, error: 'Variante no encontrada en tu sucursal', status: 404 };
    }
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }
  const outcome = (Array.isArray(data) ? data?.[0] : data) as Record<string, unknown> | null;
  if (!outcome?.ok) return { ok: false, error: 'No se pudo eliminar la variante', status: 500 };
  const label = String(outcome.label ?? '');

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'deleted',
    entityType: 'product_variant',
    entityId: variantId,
    details: { label },
  });

  return { ok: true, data: { label } };
}

export async function adjustVariantStock(
  auth: AuthInfo,
  variantId: string,
  quantity: number,
  reason: string,
  notes?: string
): Promise<ActionResult<{ previousStock: number; newStock: number }>> {
  const check = await requireStockManager(auth);
  if (!check.ok) return check;
  if (!Number.isFinite(quantity) || quantity === 0 || !reason) {
    return { ok: false, error: 'Cantidad y motivo son requeridos', status: 400 };
  }

  const { data: stockRow } = await supabaseAdmin
    .from('variant_stock')
    .select('stock')
    .eq('variant_id', variantId)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle();
  if (!stockRow) return { ok: false, error: 'Variante no encontrada en tu sucursal', status: 404 };
  const preview = adjustStock(Number(stockRow.stock) || 0, quantity);
  if (!preview.ok) return { ok: false, error: preview.error, status: 400 };

  if (quantity > 0) {
    const { data: variantRow } = await supabaseAdmin
      .from('product_variants')
      .select('product_id')
      .eq('id', variantId)
      .maybeSingle();
    if (variantRow) {
      const cap = await readVariantStockCap(String(variantRow.product_id), auth.tenantId);
      if ('error' in cap) return { ok: false, error: cap.error, status: 500 };
      const candidateTotal = cap.total + quantity;
      if (cap.cap !== null && candidateTotal > cap.cap) {
        return { ok: false, error: variantStockCapError(cap.cap, candidateTotal), status: 400 };
      }
    }
  }

  const { data, error } = await supabaseAdmin.rpc('adjust_variant_stock_atomic', {
    p_variant_id: variantId,
    p_tenant_id: auth.tenantId,
    p_quantity: quantity,
    p_reason: `${reason}${notes ? ': ' + notes : ''}`,
    p_created_by: auth.userId,
  });
  if (error) {
    logger.error('adjust_variant_stock_atomic fallo:', { error });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }
  const outcome = (Array.isArray(data) ? data?.[0] : data) as Record<string, unknown> | null;
  if (!outcome?.ok) {
    return {
      ok: false,
      error: outcome?.error === 'variant_not_found'
        ? 'Variante no encontrada' : 'El stock no puede ser negativo',
      status: outcome?.error === 'variant_not_found' ? 404 : 400,
    };
  }
  return {
    ok: true,
    data: { previousStock: Number(outcome.old_stock), newStock: Number(outcome.new_stock) },
  };
}

/**
 * Catalogo comercializable para el POS: productos simples + variantes.
 * Un producto con variantes NO aparece como fila vendible: solo sus variantes.
 */
export async function listSellableItems(auth: AuthInfo): Promise<ActionResult<SellableItem[]>> {
  const tenants = scopedTenantIds(auth);
  const buildPage = (from: number, to: number) => {
    let q = supabaseAdmin
      .from('products')
      .select(`
        id, name, description, sku, barcode, price_cents, cost,
        product_stock!inner(tenant_id, stock, active),
        product_variants(
          id, sku, barcode, label, price_cents, cost,
          variant_stock!inner(tenant_id, stock, active)
        )
      `)
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true });
    q = tenants.length === 1 ? q.eq('product_stock.tenant_id', tenants[0]) : q.in('product_stock.tenant_id', tenants);
    return q.eq('product_stock.active', true).range(from, to);
  };

  const { data, error } = await selectAllRows(buildPage);
  if (error) {
    logger.error('DB error:', { error });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const items: SellableItem[] = [];
  for (const row of data ?? []) {
    const product = row as Record<string, unknown>;
    const productStock = (product.product_stock ?? []) as Array<Record<string, unknown>>;
    const variants = (product.product_variants ?? []) as Array<Record<string, unknown>>;
    const ownProductStock = productStock.filter((s) => tenants.includes(String(s.tenant_id)));
    const ownVariants = variants
      .map((v) => {
        const stocks = (v.variant_stock ?? []) as Array<Record<string, unknown>>;
        const own = stocks.filter((s) => tenants.includes(String(s.tenant_id)) && Boolean(s.active));
        return {
          row: v,
          stock: own.reduce((sum, s) => sum + (Number(s.stock) || 0), 0),
          available: own.length > 0,
        };
      })
      .filter((v) => v.available);

    if (ownVariants.length > 0) {
      for (const variant of ownVariants) {
        items.push(toSellableItem({
          productId: String(product.id),
          name: String(product.name ?? ''),
          description: (product.description ?? null) as string | null,
          sku: (product.sku ?? null) as string | null,
          barcode: (product.barcode ?? null) as string | null,
          price: centsToPrice(product.price_cents),
          cost: product.cost == null ? null : Number(product.cost),
          stock: ownProductStock.reduce((sum, s) => sum + (Number(s.stock) || 0), 0),
          variant: {
            id: String(variant.row.id),
            sku: String(variant.row.sku ?? ''),
            barcode: (variant.row.barcode ?? null) as string | null,
            label: String(variant.row.label ?? ''),
            price: centsToPrice(variant.row.price_cents),
            cost: variant.row.cost == null ? null : Number(variant.row.cost),
            stock: variant.stock,
          },
        }));
      }
    } else {
      items.push(toSellableItem({
        productId: String(product.id),
        name: String(product.name ?? ''),
        description: (product.description ?? null) as string | null,
        sku: (product.sku ?? null) as string | null,
        barcode: (product.barcode ?? null) as string | null,
        price: centsToPrice(product.price_cents),
        cost: product.cost == null ? null : Number(product.cost),
        stock: ownProductStock.reduce((sum, s) => sum + (Number(s.stock) || 0), 0),
      }));
    }
  }
  return { ok: true, data: items };
}

/**
 * Busca un codigo de barras o SKU sin ambiguedad: primero el registro
 * compartido (producto simple o variante, segun el tenant), y como fallback el
 * barcode historico de products, que no estaba registrado antes de la 074.
 */
export async function lookupSellableByCode(
  auth: AuthInfo,
  code: string
): Promise<ActionResult<SellableItem | null>> {
  const cleaned = code.trim();
  if (!cleaned) return { ok: true, data: null };

  const { data: codes } = await supabaseAdmin
    .from('sellable_codes')
    .select('kind, tenant_id, product_id, variant_id, code')
    .eq('code', cleaned)
    .in('tenant_id', scopedTenantIds(auth));
  const matching = (codes ?? []).filter((c) => String(c.code) === cleaned);
  // Datos legacy pueden tener el mismo valor como SKU de un articulo y barcode
  // de otro. Escanear no puede adivinar: se rechaza en vez de vender el equivocado.
  const owners = new Set(matching.map((c) => `${c.product_id ?? ''}:${c.variant_id ?? ''}`));
  if (owners.size > 1) return { ok: true, data: null };
  const exact = matching[0];
  if (exact?.variant_id) {
    return resolveVariantSellable(auth, String(exact.product_id ?? ''), String(exact.variant_id));
  }
  if (exact?.product_id) {
    return resolveProductSellable(auth, String(exact.product_id));
  }

  // Legacy: barcodes de productos creados antes del registro compartido.
  const { data: legacy } = await supabaseAdmin
    .from('products')
    .select('id, name, description, sku, barcode, price_cents, cost, product_stock!inner(tenant_id, stock, active)')
    .eq('barcode', cleaned);
  for (const row of legacy ?? []) {
    const stocks = (row.product_stock ?? []) as Array<Record<string, unknown>>;
    const own = stocks.find((s) => scopedTenantIds(auth).includes(String(s.tenant_id)) && Boolean(s.active));
    if (own) {
      const found = await resolveProductSellable(auth, String(row.id));
      if (found.ok && found.data) return found;
    }
  }
  return { ok: true, data: null };
}

async function resolveProductSellable(auth: AuthInfo, productId: string): Promise<ActionResult<SellableItem | null>> {
  const { data: product, error } = await supabaseAdmin
    .from('products')
    .select('id, name, description, sku, barcode, price_cents, cost, product_stock!inner(tenant_id, stock, active)')
    .eq('id', productId)
    .maybeSingle();
  if (error || !product) return { ok: true, data: null };
  const stocks = (product.product_stock ?? []) as Array<Record<string, unknown>>;
  const own = stocks.filter((s) => scopedTenantIds(auth).includes(String(s.tenant_id)) && Boolean(s.active));
  if (own.length === 0) return { ok: true, data: null };

  const { data: variants } = await supabaseAdmin
    .from('product_variants')
    .select('id, variant_stock!inner(tenant_id, active)')
    .eq('product_id', productId);
  const hasVariants = (variants ?? []).some((v) =>
    ((v.variant_stock ?? []) as Array<Record<string, unknown>>).some((s) => scopedTenantIds(auth).includes(String(s.tenant_id)))
  );
  if (hasVariants) return { ok: true, data: null };

  return {
    ok: true,
    data: toSellableItem({
      productId: String(product.id),
      name: String(product.name ?? ''),
      description: (product.description ?? null) as string | null,
      sku: (product.sku ?? null) as string | null,
      barcode: (product.barcode ?? null) as string | null,
      price: centsToPrice(product.price_cents),
      cost: product.cost == null ? null : Number(product.cost),
      stock: own.reduce((sum, s) => sum + (Number(s.stock) || 0), 0),
    }),
  };
}

async function resolveVariantSellable(
  auth: AuthInfo,
  productId: string,
  variantId: string
): Promise<ActionResult<SellableItem | null>> {
  const { data: variant, error } = await supabaseAdmin
    .from('product_variants')
    .select(`id, product_id, sku, barcode, label, price_cents, cost,
      product:products(id, name, description, sku, barcode, price_cents, cost),
      variant_stock!inner(tenant_id, stock, active)`)
    .eq('id', variantId)
    .maybeSingle();
  if (error || !variant) return { ok: true, data: null };
  const stocks = (variant.variant_stock ?? []) as Array<Record<string, unknown>>;
  const own = stocks.filter((s) => scopedTenantIds(auth).includes(String(s.tenant_id)) && Boolean(s.active));
  if (own.length === 0) return { ok: true, data: null };
  // La relacion es muchos-a-uno: Supabase devuelve el objeto, pero segun la
  // forma del select some embed viene como lista de un elemento.
  const productRaw = variant.product as unknown;
  const product = (Array.isArray(productRaw) ? productRaw[0] : productRaw) as Record<string, unknown> | null;
  if (!product) return { ok: true, data: null };
  return {
    ok: true,
    data: toSellableItem({
      productId: String(product.id ?? productId),
      name: String(product.name ?? ''),
      description: (product.description ?? null) as string | null,
      sku: (product.sku ?? null) as string | null,
      barcode: (product.barcode ?? null) as string | null,
      price: centsToPrice(product.price_cents),
      cost: product.cost == null ? null : Number(product.cost),
      stock: own.reduce((sum, s) => sum + (Number(s.stock) || 0), 0),
      variant: {
        id: String(variant.id),
        sku: String(variant.sku ?? ''),
        barcode: (variant.barcode ?? null) as string | null,
        label: String(variant.label ?? ''),
        price: centsToPrice(variant.price_cents),
        cost: variant.cost == null ? null : Number(variant.cost),
        stock: own.reduce((sum, s) => sum + (Number(s.stock) || 0), 0),
      },
    }),
  };
}

export async function getCriticalVariants(auth: AuthInfo): Promise<ActionResult<Array<Record<string, unknown>>>> {
  const { data, error } = await supabaseAdmin.rpc('get_critical_variants', {
    p_tenant_ids: scopedTenantIds(auth),
  });
  if (error) {
    logger.error('DB error:', { error });
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }
  return {
    ok: true,
    data: ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      stock: Number(row.stock) || 0,
      min_stock: Number(row.min_stock) || 0,
      display_name: sellableDisplayName(String(row.name ?? ''), String(row.label ?? '')),
    })),
  };
}
