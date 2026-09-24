import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { AuthInfo } from '@/lib/api-auth';

export type CustomerResult<T = unknown> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

export async function listCustomers(auth: AuthInfo): Promise<CustomerResult> {
  let query = supabaseAdmin
    .from('customers')
    .select('*')
    .order('name', { ascending: true });
  if (auth.allTenants) query = query.in('tenant_id', auth.tenantIds);
  else query = query.eq('tenant_id', auth.tenantId);

  const { data, error } = await query;

  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }
  return { ok: true, data: data || [], status: 200 };
}

export async function createCustomer(
  auth: AuthInfo,
  body: Record<string, unknown>
): Promise<CustomerResult> {
  try {
    if (!body.name) {
      return { ok: false, error: 'El nombre del cliente es requerido', status: 400 };
    }

    const { data, error } = await supabaseAdmin
      .from('customers')
      .insert({
        tenant_id: auth.tenantId,
        name: body.name,
        email: body.email || null,
        phone: body.phone || null,
        address: body.address || null,
        notes: body.notes || null,
      })
      .select()
      .single();

    if (error) {
      console.error('DB error:', error);
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }
    return { ok: true, data, status: 201 };
  } catch {
    return { ok: false, error: 'Invalid request body', status: 400 };
  }
}

const CUSTOMER_ALLOWED_FIELDS = ['name', 'email', 'phone', 'address', 'notes'];

export async function updateCustomer(
  auth: AuthInfo,
  id: string,
  body: Record<string, unknown>
): Promise<CustomerResult> {
  try {
    const updates: Record<string, unknown> = {};
    for (const key of CUSTOMER_ALLOWED_FIELDS) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return { ok: false, error: 'No hay campos para actualizar', status: 400 };
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('customers')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', auth.tenantId)
      .select()
      .single();

    if (error) {
      console.error('DB error:', error);
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }
    return { ok: true, data, status: 200 };
  } catch {
    return { ok: false, error: 'Invalid request body', status: 400 };
  }
}

export async function deleteCustomer(auth: AuthInfo, id: string): Promise<CustomerResult> {
  const { error } = await supabaseAdmin
    .from('customers')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId);

  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }
  return { ok: true, data: { success: true }, status: 200 };
}

export async function getCustomerHistory(auth: AuthInfo, id: string): Promise<CustomerResult> {
  const { data: sales, error } = await supabaseAdmin
    .from('sales')
    .select(`
      id, total_cents, status, notes, created_at,
      items:sale_items(
        id, quantity, unit_price_cents, subtotal_cents,
        product:products(name)
      )
    `)
    .eq('tenant_id', auth.tenantId)
    .eq('customer_id', id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }

  const totalSpent = (sales ?? []).reduce((sum, s) => sum + (s.total_cents || 0), 0);
  const visitCount = (sales ?? []).length;

  const formatted = (sales ?? []).map((s) => ({
    ...s,
    total: (s.total_cents || 0) / 100,
    items: (s.items || []).map((i) => {
      const product = Array.isArray(i.product)
        ? (i.product[0] as Record<string, unknown> | undefined)
        : (i.product as unknown as Record<string, unknown> | undefined);
      return {
        ...i,
        unit_price: (i.unit_price_cents || 0) / 100,
        subtotal: (i.subtotal_cents || 0) / 100,
        product_name: product?.name || 'Producto',
      };
    }),
  }));

  return { ok: true, data: { sales: formatted, totalSpent: totalSpent / 100, visitCount }, status: 200 };
}