import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { AuthInfo } from '@/lib/api-auth';
import { createActivityLog } from '@/lib/activity-log';
import { PLAN_LIMITS, NEW_ACCOUNT_PLAN } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';
import { validatePrice, validateProduct, validateStock } from '@/lib/product-validation';
import { adjustStock, buildStockMovement } from '@/lib/stock';
import { isAllowedImagePath, signProductImageUrls } from '@/lib/upload-service';
import { canManageTenant, getRoleInTenant } from '@/lib/membership-role';

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
  | { ok: false; error: string; status: 400 | 403 };

export type AdjustProductStockResult =
  | {
      ok: true;
      data: {
        success: boolean;
        warning?: string;
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
  return { ok: true, products: await signProductImageUrls(products) };
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

  const allowedFields = ['category_id', 'sku', 'barcode', 'name', 'description', 'cost', 'image_url', 'metadata'];
  const insertData: Record<string, unknown> = {};
  if (body.price !== undefined) insertData.price_cents = Math.round(Number(body.price) * 100);
  for (const key of allowedFields) {
    if (body[key] !== undefined) insertData[key] = body[key];
  }
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
      'cost', 'image_url', 'metadata',
    ];
    const updateData: Record<string, unknown> = {};
    const hasPrice = body.price !== undefined && body.price !== null && body.price !== '';
    if (hasPrice) updateData.price_cents = Math.round(Number(body.price) * 100);
    for (const key of allowedFields) {
      if (body[key] !== undefined) updateData[key] = body[key];
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

async function resolveCategory(tenantId: string, name: string): Promise<string | null> {
  if (!name?.trim()) return null;

  const { data: existing } = await supabaseAdmin
    .from('categories')
    .select('id')
    .eq('tenant_id', tenantId)
    .ilike('name', name.trim())
    .maybeSingle();

  if (existing) return existing.id;

  const { data: existingColors } = await supabaseAdmin
    .from('categories')
    .select('color')
    .eq('tenant_id', tenantId)
    .not('color', 'is', null);

  const usedColors = new Set((existingColors ?? []).map((c) => c.color as string));
  const color = CATEGORY_COLOR_PALETTE.find((c) => !usedColors.has(c))
    ?? CATEGORY_COLOR_PALETTE[usedColors.size % CATEGORY_COLOR_PALETTE.length];

  const { data: created, error } = await supabaseAdmin
    .from('categories')
    .insert({ tenant_id: tenantId, name: name.trim(), color })
    .select('id')
    .single();

  if (error || !created) return null;
  return created.id;
}

const IMPORT_ALLOWED_FIELDS = ['sku', 'barcode', 'name', 'description', 'cost', 'image_url', 'metadata'];

export async function importProducts(
  auth: AuthInfo,
  products: Record<string, unknown>[] | undefined
): Promise<ImportProductsResult> {
  if (!Array.isArray(products) || products.length === 0) {
    return { ok: false, error: 'No products provided', status: 400 };
  }

  // La importación crea filas en `products` (global) y actualiza las que ya
  // existen para este tenant: es una escritura sobre el catálogo compartido.
  const managerCheck = await requireCatalogManager(auth);
  if (!managerCheck.ok) return { ok: false, error: managerCheck.error, status: 403 };

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

  const results: ImportRowResult[] = [];

  for (let i = 0; i < products.length; i++) {
    const row = products[i];
    try {
      const name = String(row.name ?? '');
      if (!name.trim()) {
        results.push({ row: i + 1, status: 'skipped', error: 'Nombre requerido' });
        continue;
      }

      const priceError = (row.price !== undefined && row.price !== null && row.price !== '') ? validatePrice(row.price) : null;
      if (priceError) {
        results.push({ row: i + 1, status: 'skipped', name, error: priceError });
        continue;
      }
      if (row.cost !== undefined && row.cost !== null && row.cost !== '') {
        const cost = Number(row.cost);
        if (Number.isNaN(cost) || cost < 0) {
          results.push({ row: i + 1, status: 'skipped', name, error: 'El costo debe ser un número no negativo' });
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
        results.push({ row: i + 1, status: 'skipped', name, error: stockValidationError });
        continue;
      }

      const upsertData: Record<string, unknown> = {};
      if (row.price !== undefined) upsertData.price_cents = Math.round(Number(row.price) * 100);
      for (const key of IMPORT_ALLOWED_FIELDS) {
        if (row[key] !== undefined && row[key] !== null && row[key] !== '') upsertData[key] = row[key];
      }

      const stock = Number(row.stock) || 0;
      const min_stock = Number(row.min_stock) || 0;
      const max_stock = Number(row.max_stock) || 0;
      const hasLocation = row.deposito !== undefined || row.pasillo !== undefined || row.estanteria !== undefined;
      const deposito = String(row.deposito ?? '').trim() || null;
      const pasillo = String(row.pasillo ?? '').trim() || null;
      const estanteria = String(row.estanteria ?? '').trim() || null;

      const categoryName = String(row.category_name ?? '');
      if (categoryName.trim()) {
        const categoryId = await resolveCategory(auth.tenantId, categoryName);
        if (categoryId) upsertData.category_id = categoryId;
      }

      let existingId: string | null = null;

      if (row.sku) {
        const { data: existing } = await supabaseAdmin
          .from('products')
          .select('id, product_stock!inner(tenant_id)')
          .eq('sku', row.sku)
          .eq('product_stock.tenant_id', auth.tenantId)
          .maybeSingle();
        if (existing) existingId = existing.id;
      }

      if (!existingId && row.barcode) {
        const { data: existing } = await supabaseAdmin
          .from('products')
          .select('id, product_stock!inner(tenant_id)')
          .eq('barcode', row.barcode)
          .eq('product_stock.tenant_id', auth.tenantId)
          .maybeSingle();
        if (existing) existingId = existing.id;
      }

      if (existingId) {
        upsertData.updated_at = new Date().toISOString();
        const { error } = await supabaseAdmin
          .from('products')
          .update(upsertData)
          .eq('id', existingId);

        if (error) {
          results.push({ row: i + 1, status: 'skipped', name, error: 'Error al importar la fila' });
        } else {
          const stockUpdate: Record<string, unknown> = { product_id: existingId, tenant_id: auth.tenantId, stock, min_stock, max_stock, active: true, updated_at: new Date().toISOString() };
          if (hasLocation) stockUpdate.deposito = deposito;
          if (hasLocation) stockUpdate.pasillo = pasillo;
          if (hasLocation) stockUpdate.estanteria = estanteria;

          const { data: prevStockRow } = await supabaseAdmin
            .from('product_stock')
            .select('stock')
            .eq('product_id', existingId)
            .eq('tenant_id', auth.tenantId)
            .maybeSingle();
          const previousStock = Number((prevStockRow as Record<string, unknown> | null)?.stock) || 0;

          await supabaseAdmin
            .from('product_stock')
            .upsert(stockUpdate, { onConflict: 'product_id,tenant_id' });

          const delta = stock - previousStock;
          if (delta !== 0) {
            const movement = buildStockMovement({
              tenantId: auth.tenantId,
              productId: existingId,
              quantity: delta,
              type: 'adjustment',
              reason: 'Importación de productos',
              createdBy: auth.userId,
            });
            const { error: histError } = await supabaseAdmin
              .from('stock_history')
              .insert(movement);
            if (histError) {
              console.error('stock_history insert error:', JSON.stringify(histError));
            }
          }
          results.push({ row: i + 1, status: 'updated', name });
        }
      } else {
        if (productCount !== null) {
          if (productCount >= maxProducts) {
            results.push({ row: i + 1, status: 'skipped', name, error: 'Límite de productos alcanzado para tu plan' });
            continue;
          }
          productCount++;
        }

        const { data: created, error } = await supabaseAdmin
          .from('products')
          .insert(upsertData)
          .select('id')
          .single();

        if (error) {
          results.push({ row: i + 1, status: 'skipped', name, error: 'Error al importar la fila' });
        } else if (created) {
          await supabaseAdmin
            .from('product_stock')
            .insert({ product_id: created.id, tenant_id: auth.tenantId, stock, min_stock, max_stock, deposito, pasillo, estanteria });

          if (stock !== 0) {
            const movement = buildStockMovement({
              tenantId: auth.tenantId,
              productId: created.id,
              quantity: stock,
              type: 'in',
              reason: 'Importación de productos',
              createdBy: auth.userId,
            });
            const { error: histError } = await supabaseAdmin
              .from('stock_history')
              .insert(movement);
            if (histError) {
              console.error('stock_history insert error:', JSON.stringify(histError));
            }
          }
          results.push({ row: i + 1, status: 'created', name });
        }
      }
    } catch {
      results.push({ row: i + 1, status: 'skipped', error: 'Error al importar la fila' });
    }
  }

  const created = results.filter((r) => r.status === 'created').length;
  const updated = results.filter((r) => r.status === 'updated').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'imported',
    entityType: 'import',
    details: { created, updated, skipped, total: products.length },
  });

  return { ok: true, body: { results, summary: { created, updated, skipped, total: products.length } } };
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
  const result = adjustStock(currentStock, quantity);
  if (!result.ok) {
    return { ok: false, error: result.error, status: 400 };
  }
  const newStock = result.newStock;

  const { error: updateError } = await supabaseAdmin
    .from('product_stock')
    .update({ stock: newStock, updated_at: new Date().toISOString() })
    .eq('product_id', id)
    .eq('tenant_id', auth.tenantId);

  if (updateError) {
    console.error('DB error:', updateError);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  let warning: string | undefined;
  const movement = buildStockMovement({
    tenantId: auth.tenantId,
    productId: id,
    quantity,
    type: 'adjustment',
    reason: `${reason}${notes ? ': ' + notes : ''}`,
    createdBy: auth.userId,
  });
  const { error: histError } = await supabaseAdmin
    .from('stock_history')
    .insert(movement);

  if (histError) {
    console.error('stock_history insert error:', JSON.stringify(histError));
    warning = 'El stock se actualizó pero no se pudo registrar en el historial.';
  }

  return {
    ok: true,
    data: {
      success: true,
      warning,
      previousStock: currentStock,
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

  if (stockData && stockData.active === false) {
    return { ok: true, product: null };
  }

  return {
    ok: true,
    product: {
      ...data,
      price: data.price_cents != null ? data.price_cents / 100 : 0,
      stock: stockData?.stock ?? 0,
      min_stock: stockData?.min_stock ?? 0,
      max_stock: stockData?.max_stock ?? 0,
    },
  };
}