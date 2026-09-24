import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { AuthInfo } from '@/lib/api-auth';

export type CategoryResult<T = unknown> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

export async function listCategories(auth: AuthInfo): Promise<CategoryResult> {
  let query = supabaseAdmin
    .from('categories')
    .select('*')
    .order('name', { ascending: true });
  if (auth.allTenants) query = query.in('tenant_id', auth.tenantIds);
  else query = query.eq('tenant_id', auth.tenantId);

  const { data, error } = await query;

  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 500 };
  }
  return { ok: true, data, status: 200 };
}

export async function createCategory(
  auth: AuthInfo,
  body: Record<string, unknown>
): Promise<CategoryResult> {
  try {
    if (!body.name) {
      return { ok: false, error: 'El nombre de la categoría es requerido', status: 400 };
    }

    const { data, error } = await supabaseAdmin
      .from('categories')
      .insert({
        name: body.name,
        description: body.description || null,
        icon: body.icon || null,
        color: body.color || null,
        tenant_id: auth.tenantId,
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

export async function updateCategory(
  auth: AuthInfo,
  id: string,
  body: Record<string, unknown>
): Promise<CategoryResult> {
  try {
    const { data, error } = await supabaseAdmin
      .from('categories')
      .update({
        name: body.name,
        description: body.description,
        icon: body.icon,
        color: body.color,
        updated_at: new Date().toISOString(),
      })
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

export async function deleteCategory(auth: AuthInfo, id: string): Promise<CategoryResult> {
  const { error } = await supabaseAdmin
    .from('categories')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId);

  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }

  return { ok: true, data: { success: true }, status: 200 };
}