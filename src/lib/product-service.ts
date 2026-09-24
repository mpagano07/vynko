import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { AuthInfo } from '@/lib/api-auth';
import { createActivityLog } from '@/lib/activity-log';
import { PLAN_LIMITS, NEW_ACCOUNT_PLAN } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';
import { validateProduct } from '@/lib/product-validation';

export type ListProductsResult =
  | { ok: true; products: Array<Record<string, unknown>> }
  | { ok: false; error: string };

export type CreateProductResult =
  | { ok: true; product: Record<string, unknown> | null }
  | { ok: false; error: string; status: 400 | 403 };

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
  return { ok: true, products };
}

export async function createProduct(auth: AuthInfo, body: Record<string, unknown>): Promise<CreateProductResult> {
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