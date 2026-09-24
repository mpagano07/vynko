import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createActivityLog } from '@/lib/activity-log';
import type { AuthInfo } from '@/lib/api-auth';

export type SupplierResult<T = unknown> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

export async function listSuppliers(auth: AuthInfo): Promise<SupplierResult> {
  let query = supabaseAdmin
    .from('suppliers')
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

export async function createSupplier(
  auth: AuthInfo,
  body: Record<string, unknown>
): Promise<SupplierResult> {
  try {
    if (!body.name) {
      return { ok: false, error: 'El nombre del proveedor es requerido', status: 400 };
    }

    const { data: existing } = await supabaseAdmin
      .from('suppliers')
      .select('id')
      .eq('tenant_id', auth.tenantId)
      .ilike('name', body.name as string)
      .maybeSingle();

    if (existing) {
      return { ok: false, error: 'Ya existe un proveedor con ese nombre', status: 409 };
    }

    const { data, error } = await supabaseAdmin
      .from('suppliers')
      .insert({
        tenant_id: auth.tenantId,
        name: body.name,
        contact_name: body.contact_name || null,
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

    await supabaseAdmin
      .from('providers')
      .insert({
        id: data.id,
        tenant_id: auth.tenantId,
        name: body.name,
        email: body.email || null,
        phone: body.phone || null,
        address: body.address || null,
      })
      .select()
      .single();

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'created',
      entityType: 'supplier',
      entityId: data.id,
      details: { name: body.name },
    });

    return { ok: true, data, status: 201 };
  } catch {
    return { ok: false, error: 'Invalid request body', status: 400 };
  }
}

const SUPPLIER_ALLOWED_FIELDS = ['name', 'contact_name', 'email', 'phone', 'address', 'notes'];

export async function updateSupplier(
  auth: AuthInfo,
  id: string,
  body: Record<string, unknown>
): Promise<SupplierResult> {
  try {
    const updateData: Record<string, unknown> = {};
    for (const key of SUPPLIER_ALLOWED_FIELDS) {
      if (body[key] !== undefined) updateData[key] = body[key];
    }
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('suppliers')
      .update(updateData)
      .eq('id', id)
      .eq('tenant_id', auth.tenantId)
      .select()
      .single();

    if (error) {
      console.error('DB error:', error);
      return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
    }

    await supabaseAdmin
      .from('providers')
      .update({
        name: updateData.name || undefined,
        email: body.email !== undefined ? body.email : undefined,
        phone: body.phone !== undefined ? body.phone : undefined,
        address: body.address !== undefined ? body.address : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', auth.tenantId);

    await createActivityLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'updated',
      entityType: 'supplier',
      entityId: id,
      details: { name: data?.name },
    });

    return { ok: true, data, status: 200 };
  } catch {
    return { ok: false, error: 'Invalid request body', status: 400 };
  }
}

export async function deleteSupplier(auth: AuthInfo, id: string): Promise<SupplierResult> {
  const { data: deleted } = await supabaseAdmin
    .from('suppliers')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .select('name')
    .single();

  if (!deleted) return { ok: false, error: 'Proveedor no encontrado', status: 404 };

  await supabaseAdmin
    .from('providers')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId);

  await createActivityLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'deleted',
    entityType: 'supplier',
    details: { name: deleted.name },
  });

  return { ok: true, data: { success: true }, status: 200 };
}