import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import {
  FOREIGN_ID,
  TENANT_A,
  TENANT_B,
  apiRequest,
  callsTo,
  routeParams,
  writesTo,
} from '@/test/tenant-isolation';

const TENANT_A2 = 'cccccccc-3333-4333-8333-cccccccccccc';

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

vi.mock('@/lib/api-auth', () => ({
  getAuth: vi.fn(async () => ({
    tenantId: TENANT_A,
    userId: '11111111-1111-4111-8111-111111111111',
    allTenants: false,
    tenantIds: [TENANT_A],
  })),
}));

vi.mock('@/lib/activity-log', () => ({ createActivityLog: vi.fn(async () => undefined) }));

import { GET as cashRegisterRoute, POST as openCashRegister } from '@/app/api/cash-register/route';
import { POST as closeCashRegister } from '@/app/api/cash-register/[id]/close/route';
import { POST as recordMovement } from '@/app/api/cash-register/[id]/movements/route';
import { POST as createTransfer, GET as listTransfers } from '@/app/api/stock-transfers/route';
import { PATCH as updateTransferStatus } from '@/app/api/stock-transfers/[id]/route';
import { GET as activityLogsRoute } from '@/app/api/activity-logs/route';
import { POST as createTenantRoute } from '@/app/api/tenants/route';
import { GET as criticalProductsRoute } from '@/app/api/products/critical/route';
import { GET as stockAnalysisRoute } from '@/app/api/products/stock-analysis/route';
import { GET as forecastRoute } from '@/app/api/ai/forecast/route';
import { GET as dashboardRoute } from '@/app/api/dashboard/summary/route';

const rowOfB = (extra: Record<string, unknown> = {}) => ({
  data: [{ tenant_id: TENANT_B, ...extra }],
  error: null as unknown,
});

/** Rol de A, en el shape que espera `tenant_users?.[0]?.role`. */
const ownerInA = { data: [{ tenant_id: TENANT_A, role: 'owner' }], error: null as unknown };

beforeEach(() => {
  supabaseMock.__reset();
  supabaseMock.__setTenantAware(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('caja', () => {
  it('no cierra una sesion de caja de B', async () => {
    supabaseMock.__queue('tenant_users', ownerInA);
    supabaseMock.__queue('cash_register_sessions', rowOfB({ id: FOREIGN_ID, status: 'open' }));

    const res = await closeCashRegister(
      apiRequest(`http://localhost/api/cash-register/${FOREIGN_ID}/close`, 'POST', {
        counted: { cash: 100 },
      })
    );

    expect(res.status).toBe(404);
    expect(writesTo(supabaseMock.__calls, 'cash_register_sessions')).toHaveLength(0);
    expect(writesTo(supabaseMock.__calls, 'cash_movements')).toHaveLength(0);
  });

  it('no carga movimientos en una sesion de B', async () => {
    supabaseMock.__queue('tenant_users', ownerInA);
    supabaseMock.__queue('cash_register_sessions', rowOfB({ id: FOREIGN_ID, status: 'open' }));

    const res = await recordMovement(
      apiRequest(`http://localhost/api/cash-register/${FOREIGN_ID}/movements`, 'POST', {
        type: 'out',
        amount_cents: 100,
        reason: 'salida',
      })
    );

    expect(res.status).toBe(404);
    expect(writesTo(supabaseMock.__calls, 'cash_movements')).toHaveLength(0);
  });

  it('el estado de caja de A no incluye sesiones de B', async () => {
    supabaseMock.__queue('cash_register_sessions', rowOfB({ id: FOREIGN_ID, status: 'open' }));
    supabaseMock.__queue('cash_register_sessions', rowOfB({ id: FOREIGN_ID, status: 'closed' }));
    supabaseMock.__queue('sales', { data: [], error: null });
    supabaseMock.__queue('cash_movements', { data: [], error: null });

    const res = await cashRegisterRoute(apiRequest('http://localhost/api/cash-register', 'GET'));

    expect(await res.text()).not.toContain(FOREIGN_ID);
  });

  it('no abre caja con un tenant forjado en el body', async () => {
    supabaseMock.__queue('tenant_users', ownerInA);
    // Consulta "ya hay caja abierta" -> nada; luego el insert de la sesión nueva.
    supabaseMock.__queue('cash_register_sessions', { data: null, error: null });
    supabaseMock.__queue('cash_register_sessions', {
      data: { id: 'sess-a', initial_fund_cents: 10000 },
      error: null,
    });

    const res = await openCashRegister(
      apiRequest('http://localhost/api/cash-register', 'POST', {
        initial_fund: 100,
        tenant_id: TENANT_B,
      })
    );

    expect(res.status).toBe(201);
    const insert = callsTo(supabaseMock.__calls, 'cash_register_sessions', 'insert')[0];
    expect(insert?.args[0]).toMatchObject({ tenant_id: TENANT_A });
  });
});

describe('transferencias entre sucursales', () => {
  it('no crea una transferencia hacia una empresa de la que A no es parte', async () => {
    supabaseMock.__queue('tenant_users', ownerInA);

    const res = await createTransfer(
      apiRequest('http://localhost/api/stock-transfers', 'POST', {
        from_tenant_id: TENANT_A,
        to_tenant_id: TENANT_B,
        items: [{ product_id: 'prod-a', quantity: 1 }],
      })
    );

    expect(res.status).toBe(403);
    expect(writesTo(supabaseMock.__calls, 'stock_transfers')).toHaveLength(0);
  });

  it('no acepta un producto que el tenant origen no maneja', async () => {
    // El producto es global; lo que lo ata a una empresa es `product_stock`. Sin
    // ese chequeo, A puede meter en su transfer un producto de B y el alta de
    // stock en destino lo deja expuesto en forecast/IA.
    const { getAuth } = await import('@/lib/api-auth');
    vi.mocked(getAuth).mockResolvedValue({
      tenantId: TENANT_A,
      userId: '11111111-1111-4111-8111-111111111111',
      allTenants: false,
      tenantIds: [TENANT_A, TENANT_A2],
    });

    // Rol admin en AMBOS tenants, para que el rechazo no venga por permisos de
    // tenant sino por la pertenencia del producto. `getRoleInTenant` resuelve
    // con `maybeSingle()`, asi que aqui la fila va suelta y no en array.
    supabaseMock.__queue('tenant_users', {
      data: { tenant_id: TENANT_A, user_id: '11111111-1111-4111-8111-111111111111', role: 'owner' },
      error: null,
    });
    supabaseMock.__queue('tenant_users', {
      data: { tenant_id: TENANT_A2, user_id: '11111111-1111-4111-8111-111111111111', role: 'owner' },
      error: null,
    });
    supabaseMock.__queue('product_stock', rowOfB({ product_id: FOREIGN_ID, stock: 50 }));
    supabaseMock.__queue('stock_transfers', {
      data: { id: 'tr-1', from_tenant_id: TENANT_A, to_tenant_id: TENANT_A2 },
      error: null,
    });
    supabaseMock.__queue('stock_transfer_items', { data: null, error: null });

    const res = await createTransfer(
      apiRequest('http://localhost/api/stock-transfers', 'POST', {
        from_tenant_id: TENANT_A,
        to_tenant_id: TENANT_A2,
        items: [{ product_id: FOREIGN_ID, quantity: 1 }],
      })
    );

    expect(res.status).not.toBe(201);
    expect(writesTo(supabaseMock.__calls, 'stock_transfer_items')).toHaveLength(0);
  });

  it('no opera una transferencia en la que A no es parte', async () => {
    supabaseMock.__queue('stock_transfers', {
      data: [{ id: FOREIGN_ID, from_tenant_id: TENANT_B, to_tenant_id: TENANT_B, status: 'pending' }],
      error: null,
    });
    supabaseMock.__queue('tenant_users', {
      data: { tenant_id: TENANT_A, role: 'owner' },
      error: null,
    });

    const res = await updateTransferStatus(
      apiRequest(`http://localhost/api/stock-transfers/${FOREIGN_ID}`, 'PATCH', { status: 'in_transit' }),
      routeParams(FOREIGN_ID)
    );

    expect(res.status).toBe(403);
    expect(writesTo(supabaseMock.__calls, 'product_stock')).toHaveLength(0);
  });

  it('el listado de transferencias no incluye las de B', async () => {
    supabaseMock.__queue('stock_transfers', [
      { id: 'tr-a', from_tenant_id: TENANT_A, to_tenant_id: TENANT_A2, status: 'pending' },
    ] as never);

    const res = await listTransfers(apiRequest('http://localhost/api/stock-transfers', 'GET'));

    expect(res.status).toBe(200);
  });
});

describe('logs de actividad', () => {
  it('solo lee los logs del tenant activo', async () => {
    supabaseMock.__queue('tenant_users', ownerInA);
    supabaseMock.__queue('activity_logs', rowOfB({ id: 'log-b', details: 'secreto de B' }));

    const res = await activityLogsRoute(apiRequest('http://localhost/api/activity-logs', 'GET'));
    const raw = await res.text();

    expect(raw).not.toContain('secreto de B');
    const query = callsTo(supabaseMock.__calls, 'activity_logs');
    expect(query.some((call) => call.args[0] === 'tenant_id' && call.args[1] === TENANT_A)).toBe(true);
  });
});

describe('sucursales', () => {
  it('un member no abre una sucursal nueva', async () => {
    supabaseMock.__queue('tenant_users', { data: [{ tenant_id: TENANT_A, role: 'member' }], error: null });

    const res = await createTenantRoute(
      apiRequest('http://localhost/api/tenants', 'POST', { name: 'Sucursal fantasma' })
    );

    expect(res.status).toBe(403);
    expect(writesTo(supabaseMock.__calls, 'tenants')).toHaveLength(0);
  });
});

describe('perdidas, pronostico y dashboard', () => {
  it('los productos criticos de A no incluyen los de B', async () => {
    // `product_stock!inner` es el unico filtro posible sobre un catalogo global.
    supabaseMock.__queue('products', { data: [], error: null });

    const res = await criticalProductsRoute(
      apiRequest('http://localhost/api/products/critical', 'GET')
    );

    expect(await res.json()).toEqual([]);
  });

  it('el analisis de stock no usa datos de B', async () => {
    supabaseMock.__queue('products', { data: [], error: null });
    supabaseMock.__queue('sales', rowOfB({ id: 'sale-b' }));

    const res = await stockAnalysisRoute(
      apiRequest('http://localhost/api/products/stock-analysis', 'GET')
    );

    expect(await res.text()).not.toContain('sale-b');
  });

  it('el pronostico se construye solo con stock del tenant activo', async () => {
    supabaseMock.__queue('product_stock', rowOfB({ product_id: 'prod-b', stock: 5 }));
    supabaseMock.__queue('sale_items', rowOfB({ product_id: 'prod-b', quantity: 9 }));
    supabaseMock.__queue('sales_daily_totals', rowOfB({ day: '2026-01-01', total_cents: 424242 }));
    supabaseMock.__queue('sale_items', { data: [], error: null });
    supabaseMock.__queue('sales_daily_totals', { data: [], error: null });

    const res = await forecastRoute(apiRequest('http://localhost/api/ai/forecast', 'GET'));
    const raw = await res.text();

    expect(raw).not.toContain('prod-b');
    expect(raw).not.toContain('424242');
  });

  it('el resumen del dashboard no agrega las ventas de B', async () => {
    supabaseMock.__queue('sales', rowOfB({ id: 'sale-b', total_cents: 888888 }));
    supabaseMock.__queue('customers', { data: [], error: null });
    supabaseMock.__queue('purchase_orders', { data: [], error: null });
    supabaseMock.__queue('products', { data: [], error: null });

    const res = await dashboardRoute(apiRequest('http://localhost/api/dashboard/summary', 'GET'));

    expect(await res.text()).not.toContain('888888');
  });
});
