import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { normalizeCheckoutSettings, PAYMENT_METHODS, type CheckoutSettings } from '@/lib/payment-methods';
import type { AuthInfo } from '@/lib/api-auth';

export type SettingsResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

export async function getCheckoutSettings(auth: AuthInfo): Promise<SettingsResult> {
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('settings')
    .eq('id', auth.tenantId)
    .single();

  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('role')
    .eq('user_id', auth.userId)
    .eq('tenant_id', auth.tenantId);

  const role = tu?.[0]?.role;
  const canEdit = role === 'owner' || role === 'manager';

  const settings = normalizeCheckoutSettings(
    (tenant?.settings as Record<string, unknown> | undefined)?.checkout
  );
  return { ok: true, data: { checkout: settings, settings, canEdit } };
}

export async function updateCheckoutSettings(
  auth: AuthInfo,
  body: Partial<CheckoutSettings>
): Promise<SettingsResult> {
  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('role')
    .eq('user_id', auth.userId)
    .eq('tenant_id', auth.tenantId);

  const membership = tu?.[0];
  if (!membership) {
    return { ok: false, error: 'No tenant found', status: 404 };
  }
  if (!['owner', 'manager'].includes(membership.role)) {
    return { ok: false, error: 'Solo el dueño o un administrador puede cambiar la configuración de cobro', status: 403 };
  }

  const next = normalizeCheckoutSettings(body);

  const { data: current } = await supabaseAdmin
    .from('tenants')
    .select('settings')
    .eq('id', auth.tenantId)
    .single();

  const raw = (current?.settings as Record<string, unknown> | undefined) ?? {};
  const settings = {
    ...(typeof raw === 'object' && raw !== null ? raw : {}),
    checkout: next,
  };

  const { error } = await supabaseAdmin
    .from('tenants')
    .update({ settings, updated_at: new Date().toISOString() })
    .eq('id', auth.tenantId);

  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }

  const adjustments = PAYMENT_METHODS.map((m) => `${m.label}: ${next.payment_adjustments[m.id]}%`).join(', ');
  return { ok: true, data: { checkout: next, saved: true, adjustments } };
}

export async function updateProfile(
  user: { id: string; email?: string | null },
  body: Record<string, unknown>
): Promise<SettingsResult> {
  const { full_name } = body;

  if (!full_name || typeof full_name !== 'string') {
    return { ok: false, error: 'full_name is required', status: 400 };
  }

  const { data: tenantUser } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', user.id)
    .maybeSingle();

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .upsert({
      id: user.id,
      full_name: full_name.trim(),
      email: user.email,
      tenant_id: tenantUser?.tenant_id || null,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }

  return { ok: true, data: { profile: data } };
}

const TENANT_ALLOWED_FIELDS = [
  'name', 'company_name', 'description', 'razon_social', 'cuit', 'punto_venta',
  'iva_condition', 'ingresos_brutos', 'inicio_actividades',
  'business_address', 'business_city', 'business_province',
  'business_zip', 'business_phone', 'business_email',
];

export async function updateTenantSettings(
  auth: AuthInfo,
  body: Record<string, unknown>
): Promise<SettingsResult> {
  const { data: tu } = await supabaseAdmin
    .from('tenant_users')
    .select('role')
    .eq('user_id', auth.userId)
    .eq('tenant_id', auth.tenantId);

  const membership = tu?.[0];
  if (!membership) {
    return { ok: false, error: 'No tenant found', status: 404 };
  }

  if (membership.role !== 'owner') {
    return { ok: false, error: 'Only the owner can update company settings', status: 403 };
  }

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

  for (const field of TENANT_ALLOWED_FIELDS) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  if (updateData.name !== undefined && (!updateData.name || !String(updateData.name).trim())) {
    return { ok: false, error: 'Invalid name', status: 400 };
  }

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .update(updateData)
    .eq('id', auth.tenantId)
    .select()
    .single();

  if (error) {
    console.error('DB error:', error);
    return { ok: false, error: 'Ocurrio un error inesperado. Intenta de nuevo.', status: 400 };
  }

  return { ok: true, data: { tenant: data } };
}