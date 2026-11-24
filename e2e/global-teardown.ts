/**
 * Teardown global de los tests E2E. Corre SIEMPRE al final de la ejecución
 * (Playwright Playwright lo invoca aunque falle un test, a diferencia de un
 * `afterAll` por-spec que se salta cuando una serie `serial` se aborta).
 *
 * Deja el entorno en el estado base esperado para la próxima corrida:
 *   1. Elimina los productos residuales de prueba (`* E2E *`) SOLO de las
 *      sucursales del usuario E2E.
 *   2. Restaura las sucursales del usuario E2E a Business/active.
 *
 * Guardia de seguridad: el teardown es destructivo. Si `NEXT_PUBLIC_SUPABASE_URL`
 * no apunta a un Supabase local, no hace nada salvo que se pida explícitamente
 * con `E2E_ALLOW_REMOTE=1` (CI con un proyecto de test dedicado).
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

function isLocalSupabase(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

export default async function globalTeardown() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const e2eEmail = process.env.E2E_USER_EMAIL ?? '';
  if (!url || !key || !e2eEmail) return;

  if (!isLocalSupabase(url) && process.env.E2E_ALLOW_REMOTE !== '1') {
    console.warn(
      '[globalTeardown] NEXT_PUBLIC_SUPABASE_URL no es local; se omite la limpieza. ' +
        'Usá E2E_ALLOW_REMOTE=1 solo contra un proyecto de test dedicado.'
    );
    return;
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', e2eEmail)
    .single();

  if (!profile) {
    console.warn('[globalTeardown] No se encontró el usuario E2E; no hay nada que limpiar.');
    return;
  }

  const { data: tu } = await admin
    .from('tenant_users')
    .select('tenant_id')
    .eq('user_id', profile.id)
    .in('role', ['owner', 'admin']);

  const tenantIds = [...new Set((tu ?? []).map((t) => t.tenant_id as string))];

  // 1) Limpiar productos E2E residuales, acotado a las sucursales del usuario
  // E2E. `products` es global desde la migración 016: el tenant se resuelve por
  // `product_stock`, nunca por una columna `products.tenant_id` que ya no existe.
  if (tenantIds.length > 0) {
    const { data: stockRows } = await admin
      .from('product_stock')
      .select('product_id')
      .in('tenant_id', tenantIds);
    const stockProductIds = [
      ...new Set((stockRows ?? []).map((s) => s.product_id as string).filter(Boolean)),
    ];

    const ids: string[] = [];
    for (let i = 0; i < stockProductIds.length; i += 200) {
      const chunk = stockProductIds.slice(i, i + 200);
      const { data: products } = await admin
        .from('products')
        .select('id')
        .in('id', chunk)
        .ilike('name', '%E2E%');
      ids.push(...(products ?? []).map((p) => p.id as string));
    }

    if (ids.length > 0) {
      const { data: items } = await admin
        .from('sale_items')
        .select('sale_id')
        .in('product_id', ids);
      const saleIds = [...new Set((items ?? []).map((i: { sale_id: string }) => i.sale_id))];
      // `sale_items` no tiene tenant_id: el scope lo pone `sales.tenant_id`.
      if (saleIds.length > 0) {
        const { data: scopedSales } = await admin
          .from('sales')
          .select('id')
          .in('tenant_id', tenantIds)
          .in('id', saleIds);
        const scopedSaleIds = (scopedSales ?? []).map((s) => s.id as string);
        if (scopedSaleIds.length > 0) {
          await admin.from('sales').delete().in('id', scopedSaleIds);
        }
      }
      await admin
        .from('product_stock')
        .delete()
        .in('product_id', ids)
        .in('tenant_id', tenantIds);
      for (const id of ids) {
        await admin.from('products').delete().eq('id', id);
      }
      console.log(`[globalTeardown] Eliminados ${ids.length} productos E2E residuales`);
    }
  }

  // 2) Restaurar billing base (Business/active) en todas las sucursales del owner
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
