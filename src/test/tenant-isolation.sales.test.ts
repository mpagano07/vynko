import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import {
  FOREIGN_ID,
  TENANT_A,
  TENANT_B,
  apiRequest,
  routeParams,
  writesTo,
} from '@/test/tenant-isolation';

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

vi.mock('@/lib/api-auth', async () => {
  const mod = await import('@/test/tenant-isolation');
  return { getAuth: vi.fn(async () => mod.authAsTenantA()) };
});

vi.mock('@/lib/activity-log', () => ({ createActivityLog: vi.fn(async () => undefined) }));

import { POST as createSaleRoute, GET as listSalesRoute } from '@/app/api/sales/route';
import { GET as getSaleRoute } from '@/app/api/sales/[id]/route';
import { GET as salesSummaryRoute } from '@/app/api/sales/summary/route';

// `products` es global: la fila no lleva tenant_id y el aislamiento real vive en
// `product_stock`. Por eso el nombre de B aparece en la respuesta si el servicio
// resuelve el producto sin exigir la pertenencia al tenant activo.
const PRODUCT_NAME_OF_B = 'Producto confidencial de B';

const SALE_BODY = (productId: string) => ({
  items: [{ product_id: productId, quantity: 1 }],
  payment_method: 'cash',
  amount_paid: 20,
});

beforeEach(() => {
  supabaseMock.__reset();
  supabaseMock.__setTenantAware(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ventas: Empresa A no opera sobre datos de la Empresa B', () => {
  it('no revela el nombre de un producto de B al mandarlo en una venta', async () => {
    supabaseMock.__queue('tenants', { data: { settings: null }, error: null });
    supabaseMock.__queue('cash_register_sessions', { data: null, error: null });
    supabaseMock.__queue('products', {
      data: [{ id: FOREIGN_ID, name: PRODUCT_NAME_OF_B, price_cents: 150000 }],
      error: null,
    });
    supabaseMock.__queue('product_stock', { data: [], error: null });

    const res = await createSaleRoute(
      apiRequest('http://localhost/api/sales', 'POST', SALE_BODY(FOREIGN_ID))
    );
    const raw = await res.text();

    expect(raw).not.toContain(PRODUCT_NAME_OF_B);
  });

  it('rechaza una venta con customer_id de B', async () => {
    supabaseMock.__queue('tenants', { data: { settings: null }, error: null });
    supabaseMock.__queue('cash_register_sessions', { data: null, error: null });
    supabaseMock.__queue('customers', {
      data: { id: FOREIGN_ID, tenant_id: TENANT_B, name: 'Cliente de B' },
      error: null,
    });

    const res = await createSaleRoute(
      apiRequest('http://localhost/api/sales', 'POST', {
        ...SALE_BODY(FOREIGN_ID),
        customer_id: FOREIGN_ID,
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'El cliente no pertenece a esta sucursal' });
  });

  it('ignora un tenant_id/company_id forjado en el body', async () => {
    // El ataque que describia el checklist: POST /api/sales con la empresa
    // ajena en el body. La venta tiene que quedar en la empresa del usuario.
    supabaseMock.__queue('tenants', { data: { settings: null }, error: null });
    supabaseMock.__queue('cash_register_sessions', { data: null, error: null });
    supabaseMock.__queue('products', {
      data: [{ id: 'prod-a', name: 'Producto de A', price_cents: 1500 }],
      error: null,
    });
    supabaseMock.__queue('product_stock', {
      data: [{ product_id: 'prod-a', tenant_id: TENANT_A, stock: 10 }],
      error: null,
    });
    supabaseMock.__queue('product_stock', {
      data: { id: 'stock-a', product_id: 'prod-a', tenant_id: TENANT_A, stock: 10 },
      error: null,
    });
    // El descuento de stock es un compare-and-swap: si el update no devuelve
    // filas, `decrementStockAtomic` reintenta. Hay que devolver la fila para
    // que el flujo termine.
    supabaseMock.__queue('product_stock', { data: [{ id: 'stock-a' }], error: null });
    // No se encolan `sales`/`sale_payments`/`sale_items`/`stock_history`: desde
    // `create_sale_atomic` esas cuatro escrituras ocurren adentro de la RPC, asi
    // que encolar resultados para ellas solo moveria la cola sin que ningun
    // codigo los consuma.

    const res = await createSaleRoute(
      apiRequest('http://localhost/api/sales', 'POST', {
        ...SALE_BODY('prod-a'),
        tenant_id: TENANT_B,
        company_id: TENANT_B,
      })
    );

    expect(res.status, 'la venta de A tiene que completarse').toBe(201);

    // La venta ya no se inserta con un `insert` en `sales`: la crea
    // `create_sale_atomic`, asi que el aislamiento se afirma sobre los
    // argumentos de la RPC. La propiedad probada es la misma: el tenant sale de
    // la sesion, nunca del body.
    const rpcCall = supabaseMock.rpc.mock.calls.find(([fn]) => fn === 'create_sale_atomic');
    const saleArgs = rpcCall?.[1] as Record<string, unknown> | undefined;

    expect(saleArgs).toMatchObject({ p_tenant_id: TENANT_A });
    // El id del body no debe aparecer en ningun argumento de la RPC.
    expect(JSON.stringify(saleArgs)).not.toContain(TENANT_B);

    // Y ningun write a `sales` puede traer el tenant forjado.
    for (const call of writesTo(supabaseMock.__calls, 'sales')) {
      expect(JSON.stringify(call.args)).not.toContain(TENANT_B);
    }
  });

  it('no devuelve la venta de B por id', async () => {
    supabaseMock.__queue('sales', {
      data: [{ id: FOREIGN_ID, tenant_id: TENANT_B, total_cents: 50000 }],
      error: null,
    });

    const res = await getSaleRoute(
      apiRequest(`http://localhost/api/sales/${FOREIGN_ID}`, 'GET'),
      routeParams(FOREIGN_ID)
    );
    const raw = await res.text();

    expect(res.status).toBe(404);
    expect(raw).not.toContain('50000');
  });

  it('el listado de ventas excluye las de B', async () => {
    supabaseMock.__queue('sales', {
      data: [{ id: FOREIGN_ID, tenant_id: TENANT_B, total_cents: 77777 }],
      error: null,
    });
    supabaseMock.__queue('sales', { data: { total: 0 }, error: null });

    const res = await listSalesRoute(apiRequest('http://localhost/api/sales', 'GET'));
    const raw = await res.text();

    expect(raw).not.toContain('77777');
  });

  it('el resumen de ventas no agrega los totales de B', async () => {
    supabaseMock.__queue('sales_daily_totals', {
      data: [{ day: '2026-01-01', tenant_id: TENANT_B, total_cents: 999999, sale_count: 3 }],
      error: null,
    });

    const res = await salesSummaryRoute(
      apiRequest('http://localhost/api/sales/summary?days=30', 'GET')
    );
    const raw = await res.text();

    expect(raw).not.toContain('999999');
  });
});
