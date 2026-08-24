import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';
import { PLAN_LIMITS } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';

async function resolveCategory(tenantId: string, name: string): Promise<string | null> {
  if (!name?.trim()) return null;

  const { data: existing } = await supabaseAdmin
    .from('categories')
    .select('id')
    .eq('tenant_id', tenantId)
    .ilike('name', name.trim())
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabaseAdmin
    .from('categories')
    .insert({ tenant_id: tenantId, name: name.trim() })
    .select('id')
    .single();

  if (error || !created) return null;
  return created.id;
}

const ALLOWED_FIELDS = ['sku', 'barcode', 'name', 'description', 'cost', 'image_url', 'metadata'];

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const products = body.products as Record<string, unknown>[];

  if (!Array.isArray(products) || products.length === 0) {
    return NextResponse.json({ error: 'No products provided' }, { status: 400 });
  }

  const { data: tenantRow } = await supabaseAdmin
    .from('tenants')
    .select('subscription_plan')
    .eq('id', auth.tenantId)
    .single();

  const plan = (tenantRow?.subscription_plan as PlanId) || 'starter';
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

  const results: { row: number; status: 'created' | 'updated' | 'skipped'; name?: string; error?: string }[] = [];

  for (let i = 0; i < products.length; i++) {
    const row = products[i];
    try {
      const name = String(row.name ?? '');
      if (!name.trim()) {
        results.push({ row: i + 1, status: 'skipped', error: 'Nombre requerido' });
        continue;
      }

      const upsertData: Record<string, unknown> = {};
      if (row.price !== undefined) upsertData.price_cents = Math.round(Number(row.price) * 100);
      for (const key of ALLOWED_FIELDS) {
        if (row[key] !== undefined && row[key] !== null && row[key] !== '') upsertData[key] = row[key];
      }

      const stock = Number(row.stock) || 0;
      const min_stock = Number(row.min_stock) || 0;
      const max_stock = Number(row.max_stock) || 0;

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
          await supabaseAdmin
            .from('product_stock')
            .upsert({ product_id: existingId, tenant_id: auth.tenantId, stock, min_stock, max_stock, active: true, updated_at: new Date().toISOString() },
              { onConflict: 'product_id,tenant_id' });
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
            .insert({ product_id: created.id, tenant_id: auth.tenantId, stock, min_stock, max_stock });
          results.push({ row: i + 1, status: 'created', name });
        }
      }
    } catch {
      results.push({ row: i + 1, status: 'skipped', error: 'Error al importar la fila' });
    }
  }

  const created = results.filter(r => r.status === 'created').length;
  const updated = results.filter(r => r.status === 'updated').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'imported',
    entityType: 'import',
    details: { created, updated, skipped, total: products.length },
  });

  return NextResponse.json({ results, summary: { created, updated, skipped, total: products.length } });
}
