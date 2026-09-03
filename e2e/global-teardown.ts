/**
 * Teardown global de los tests E2E. Corre SIEMPRE al final de la ejecución
 * (Playwright Playwright lo invoca aunque falle un test, a diferencia de un
 * `afterAll` por-spec que se salta cuando una serie `serial` se aborta).
 *
 * Deja el entorno en el estado base esperado para la próxima corrida:
 *   1. Elimina los productos residuales de prueba (`* E2E *`).
 *   2. Restaura las sucursales del usuario E2E a Business/active.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

export default async function globalTeardown() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const e2eEmail = process.env.E2E_USER_EMAIL ?? '';
  if (!url || !key || !e2eEmail) return;

  const admin = createClient(url, key, { auth: { persistSession: false } });

  // 1) Limpiar productos E2E residuales
  const { data: products } = await admin.from('products').select('id').ilike('name', '%E2E%');
  const ids = (products ?? []).map((p) => p.id);
  if (ids.length > 0) {
    const { data: items } = await admin
      .from('sale_items')
      .select('sale_id')
      .in('product_id', ids);
    const saleIds = [...new Set((items ?? []).map((i: { sale_id: string }) => i.sale_id))];
    if (saleIds.length > 0) {
      await admin.from('sales').delete().in('id', saleIds);
    }
    await admin.from('product_stock').delete().in('product_id', ids);
    for (const id of ids) {
      await admin.from('products').delete().eq('id', id);
    }
    console.log(`[globalTeardown] Eliminados ${ids.length} productos E2E residuales`);
  }

  // 2) Restaurar billing base (Business/active) en todas las sucursales del owner
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', e2eEmail)
    .single();
  if (profile) {
    const { data: tu } = await admin
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', profile.id)
      .in('role', ['owner', 'admin']);
    const tenantIds = (tu ?? []).map((t) => t.tenant_id);
    if (tenantIds.length > 0) {
      await admin
        .from('tenants')
        .update({
          subscription_status: 'active',
          subscription_plan: 'business',
          mercadopago_preapproval_id: null,
          subscription_current_period_end: null,
        })
        .in('id', tenantIds);
    }
  }
}
