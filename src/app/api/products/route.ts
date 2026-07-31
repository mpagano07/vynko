import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';
import { PLAN_LIMITS } from '@/lib/plans';
import type { PlanId } from '@/lib/plans';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let q = supabaseAdmin
    .from('products')
    .select(`
      *,
      stock_data:product_stock(
        stock,
        min_stock,
        max_stock
      )
    `);
  if (!auth.allTenants) {
    q = q.eq('product_stock.tenant_id', auth.tenantId);
  }
  q = q.eq('product_stock.active', true);
  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const products = (data as any[])?.map((p: any) => ({
    ...p,
    stock: p.stock_data?.[0]?.stock ?? 0,
    min_stock: p.stock_data?.[0]?.min_stock ?? 0,
    max_stock: p.stock_data?.[0]?.max_stock ?? 0,
    stock_data: undefined,
    price: p.price_cents != null ? p.price_cents / 100 : 0,
  })) || [];
  return NextResponse.json(products);
}

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data: tenantRow } = await supabaseAdmin
    .from('tenants')
    .select('subscription_plan')
    .eq('id', auth.tenantId)
    .single();

  const plan = (tenantRow?.subscription_plan as PlanId) || 'starter';
  const maxProducts = PLAN_LIMITS[plan]?.products ?? 50;
  if (maxProducts !== Infinity) {
    const { count } = await supabaseAdmin
      .from('product_stock')
      .select('product_id', { count: 'exact', head: true })
      .eq('tenant_id', auth.tenantId)
      .eq('active', true);
    if ((count ?? 0) >= maxProducts) {
      return NextResponse.json(
        { error: `Tu plan actual (${plan}) permite hasta ${maxProducts} productos. Mejorá tu plan para seguir agregando.` },
        { status: 403 }
      );
    }
  }

  const body = await request.json();
  const allowedFields = ['category_id', 'sku', 'barcode', 'name', 'description', 'cost', 'image_url', 'metadata'];
  const insertData: Record<string, any> = {};
  if (body.price !== undefined) insertData.price_cents = Math.round(body.price * 100);
  for (const key of allowedFields) {
    if (body[key] !== undefined) insertData[key] = body[key];
  }

  const { data, error } = await supabaseAdmin
    .from('products')
    .insert(insertData)
    .select();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
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
      });
    if (stockError) {
      await supabaseAdmin.from('products').delete().eq('id', created.id);
      return NextResponse.json({ error: stockError.message }, { status: 400 });
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
  return NextResponse.json(created ? { ...created, price: (created as any).price_cents != null ? (created as any).price_cents / 100 : 0, stock: body.stock ?? 0, min_stock: body.min_stock ?? 0, max_stock: body.max_stock ?? 0 } : null, { status: 201 });
}
