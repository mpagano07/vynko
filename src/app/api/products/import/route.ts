import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAndNotifyStock } from '@/lib/notifications';

async function getAuthenticatedTenant(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id);

  if (!tu || tu.length === 0) return null;
  return tu[0].tenant_id;
}

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

const ALLOWED_FIELDS = ['sku', 'barcode', 'name', 'description', 'cost', 'stock', 'min_stock', 'max_stock', 'image_url', 'metadata'];

export async function POST(request: Request) {
  const tenantId = await getAuthenticatedTenant();
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const products = body.products as Record<string, any>[];

  if (!Array.isArray(products) || products.length === 0) {
    return NextResponse.json({ error: 'No products provided' }, { status: 400 });
  }

  const results: { row: number; status: 'created' | 'updated' | 'skipped'; name?: string; error?: string }[] = [];

  for (let i = 0; i < products.length; i++) {
    const row = products[i];
    try {
      if (!row.name?.trim()) {
        results.push({ row: i + 1, status: 'skipped', error: 'Nombre requerido' });
        continue;
      }

      const upsertData: Record<string, any> = { tenant_id: tenantId };
      if (row.price !== undefined) upsertData.price_cents = Math.round(Number(row.price) * 100);
      for (const key of ALLOWED_FIELDS) {
        if (row[key] !== undefined && row[key] !== null && row[key] !== '') upsertData[key] = row[key];
      }

      if (row.category_name?.trim()) {
        const categoryId = await resolveCategory(tenantId, row.category_name);
        if (categoryId) upsertData.category_id = categoryId;
      }

      let existingId: string | null = null;

      if (row.sku) {
        const { data: existing } = await supabaseAdmin
          .from('products')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('sku', row.sku)
          .maybeSingle();
        if (existing) existingId = existing.id;
      }

      if (!existingId && row.barcode) {
        const { data: existing } = await supabaseAdmin
          .from('products')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('barcode', row.barcode)
          .maybeSingle();
        if (existing) existingId = existing.id;
      }

      if (existingId) {
        upsertData.updated_at = new Date().toISOString();
        const { error } = await supabaseAdmin
          .from('products')
          .update(upsertData)
          .eq('id', existingId)
          .eq('tenant_id', tenantId);

        if (error) {
          results.push({ row: i + 1, status: 'skipped', name: row.name, error: error.message });
        } else {
          if (row.stock !== undefined || row.min_stock !== undefined) {
            await checkAndNotifyStock(tenantId, existingId);
          }
          results.push({ row: i + 1, status: 'updated', name: row.name });
        }
      } else {
        const { error } = await supabaseAdmin
          .from('products')
          .insert(upsertData);

        if (error) {
          results.push({ row: i + 1, status: 'skipped', name: row.name, error: error.message });
        } else {
          results.push({ row: i + 1, status: 'created', name: row.name });
        }
      }
    } catch (err: any) {
      results.push({ row: i + 1, status: 'skipped', error: err.message });
    }
  }

  const created = results.filter(r => r.status === 'created').length;
  const updated = results.filter(r => r.status === 'updated').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  return NextResponse.json({ results, summary: { created, updated, skipped, total: products.length } });
}
