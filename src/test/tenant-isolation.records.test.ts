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

vi.mock('@/lib/supabaseAdmin', async () => {
  const mod = await import('@/test/supabase-mock');
  return { supabaseAdmin: mod.supabaseMock };
});

vi.mock('@/lib/api-auth', async () => {
  const mod = await import('@/test/tenant-isolation');
  return { getAuth: vi.fn(async () => mod.authAsTenantA()) };
});

vi.mock('@/lib/activity-log', () => ({ createActivityLog: vi.fn(async () => undefined) }));

import { GET as listCustomersRoute, POST as createCustomerRoute } from '@/app/api/customers/route';
import { DELETE as deleteCustomerRoute, PATCH as updateCustomerRoute } from '@/app/api/customers/[id]/route';
import { GET as listSuppliersRoute } from '@/app/api/suppliers/route';
import { DELETE as deleteSupplierRoute, PATCH as updateSupplierRoute } from '@/app/api/suppliers/[id]/route';
import { GET as listDocumentsRoute, POST as createDocumentRoute } from '@/app/api/documents/route';
import { GET as getDocumentRoute } from '@/app/api/documents/[id]/route';
import { GET as listPurchaseOrdersRoute, POST as createPurchaseOrderRoute } from '@/app/api/purchase-orders/route';
import { DELETE as deleteCategoryRoute, PATCH as updateCategoryRoute } from '@/app/api/categories/[id]/route';

const NAME_OF_B = 'Nombre confidencial de B';

/** Cuerpo minimo que `createDocument` acepta, para llegar a la validacion de refs. */
const VALID_DOCUMENT = {
  document_type: 'remito_salida',
  customer_name: 'Cliente de A',
  items: [{ product_id: 'prod-a', quantity: 1, unit_price: 10 }],
};

/** Una fila de la Empresa B, con su `tenant_id` para que el mock la oculte. */
const rowOfB = (extra: Record<string, unknown> = {}) => ({
  data: [{ tenant_id: TENANT_B, ...extra }],
  error: null as unknown,
});

beforeEach(() => {
  supabaseMock.__reset();
  supabaseMock.__setTenantAware(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('clientes', () => {
  it('el listado de A no incluye clientes de B', async () => {
    supabaseMock.__queue('customers', rowOfB({ id: FOREIGN_ID, name: NAME_OF_B }));

    const res = await listCustomersRoute(apiRequest('http://localhost/api/customers', 'GET'));

    expect(await res.text()).not.toContain(NAME_OF_B);
  });

  it('no edita un cliente de B', async () => {
    supabaseMock.__queue('customers', rowOfB({ id: FOREIGN_ID, name: NAME_OF_B }));

    const res = await updateCustomerRoute(
      apiRequest(`http://localhost/api/customers/${FOREIGN_ID}`, 'PATCH', { name: 'Secuestrado' }),
      routeParams(FOREIGN_ID)
    );
    const raw = await res.text();

    expect(res.status).not.toBe(200);
    expect(raw).not.toContain('Secuestrado');
  });

  it('no borra un cliente de B', async () => {
    supabaseMock.__queue('customers', rowOfB({ id: FOREIGN_ID, name: NAME_OF_B }));

    await deleteCustomerRoute(
      apiRequest(`http://localhost/api/customers/${FOREIGN_ID}`, 'DELETE'),
      routeParams(FOREIGN_ID)
    );

    // El borrado lleva el tenant en la propia sentencia, asi que la fila de B
    // queda fuera del alcance aunque la API responda 200.
    const query = callsTo(supabaseMock.__calls, 'customers');
    expect(query.some((call) => call.method === 'delete')).toBe(true);
    expect(query.some((call) => call.args[0] === 'tenant_id' && call.args[1] === TENANT_A)).toBe(true);
    expect(JSON.stringify(query)).not.toContain(TENANT_B);
  });

  it('el alta ignora un tenant_id forjado en el body', async () => {
    supabaseMock.__queue('customers', {
      data: { id: 'new-1', tenant_id: TENANT_A, name: 'Cliente de A' },
      error: null,
    });

    const res = await createCustomerRoute(
      apiRequest('http://localhost/api/customers', 'POST', {
        name: 'Cliente de A',
        tenant_id: TENANT_B,
      })
    );

    expect(res.status).toBe(201);
    expect(callsTo(supabaseMock.__calls, 'customers', 'insert')[0]?.args[0]).toMatchObject({
      tenant_id: TENANT_A,
    });
  });
});

describe('proveedores', () => {
  it('el listado de A no incluye proveedores de B', async () => {
    supabaseMock.__queue('suppliers', rowOfB({ id: FOREIGN_ID, name: NAME_OF_B }));

    const res = await listSuppliersRoute(apiRequest('http://localhost/api/suppliers', 'GET'));

    expect(await res.text()).not.toContain(NAME_OF_B);
  });

  it('no edita un proveedor de B', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue('suppliers', rowOfB({ id: FOREIGN_ID, name: NAME_OF_B }));

    const res = await updateSupplierRoute(
      apiRequest(`http://localhost/api/suppliers/${FOREIGN_ID}`, 'PATCH', { name: 'Secuestrado' }),
      routeParams(FOREIGN_ID)
    );

    expect(res.status).not.toBe(200);
    // `updateSupplier` espeja el cambio en `providers`: tampoco puede tocar la
    // fila de B ahi.
    expect(JSON.stringify(callsTo(supabaseMock.__calls, 'providers', 'update'))).not.toContain(
      TENANT_B
    );
  });

  it('no borra un proveedor de B', async () => {
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue('suppliers', rowOfB({ id: FOREIGN_ID, name: NAME_OF_B }));

    const res = await deleteSupplierRoute(
      apiRequest(`http://localhost/api/suppliers/${FOREIGN_ID}`, 'DELETE'),
      routeParams(FOREIGN_ID)
    );

    expect(res.status).toBe(404);
  });
});

describe('categorias', () => {
  it('no borra una categoria de B', async () => {
    supabaseMock.__queue('categories', rowOfB({ id: FOREIGN_ID, name: NAME_OF_B }));

    await deleteCategoryRoute(
      apiRequest(`http://localhost/api/categories/${FOREIGN_ID}`, 'DELETE'),
      routeParams(FOREIGN_ID)
    );

    const query = callsTo(supabaseMock.__calls, 'categories');
    expect(query.some((call) => call.method === 'delete')).toBe(true);
    expect(query.some((call) => call.args[0] === 'tenant_id' && call.args[1] === TENANT_A)).toBe(true);
    expect(JSON.stringify(query)).not.toContain(TENANT_B);
  });

  it('no renombra una categoria de B', async () => {
    supabaseMock.__queue('categories', rowOfB({ id: FOREIGN_ID, name: NAME_OF_B }));

    const res = await updateCategoryRoute(
      apiRequest(`http://localhost/api/categories/${FOREIGN_ID}`, 'PATCH', { name: 'Secuestrada' }),
      routeParams(FOREIGN_ID)
    );

    expect(res.status).not.toBe(200);
  });
});

describe('documentos', () => {
  it('el listado de A no incluye documentos de B', async () => {
    supabaseMock.__queue('commercial_documents', rowOfB({ id: FOREIGN_ID, document_number: 4242 }));

    const res = await listDocumentsRoute(apiRequest('http://localhost/api/documents', 'GET'));

    expect(await res.text()).not.toContain('4242');
  });

  it('no abre un documento de B por id', async () => {
    supabaseMock.__queue('commercial_documents', rowOfB({ id: FOREIGN_ID, document_number: 4242 }));

    const res = await getDocumentRoute(
      apiRequest(`http://localhost/api/documents/${FOREIGN_ID}`, 'GET'),
      routeParams(FOREIGN_ID)
    );

    expect(res.status).not.toBe(200);
    expect(await res.text()).not.toContain('4242');
  });

  it('rechaza vincular un documento con la venta de B', async () => {
    supabaseMock.__queue('sales', rowOfB({ id: FOREIGN_ID }));

    const res = await createDocumentRoute(
      apiRequest('http://localhost/api/documents', 'POST', {
        ...VALID_DOCUMENT,
        sale_id: FOREIGN_ID,
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'La venta no pertenece a tu sucursal' });
  });

  it('rechaza vincular un documento con el cliente de B', async () => {
    supabaseMock.__queue('customers', rowOfB({ id: FOREIGN_ID }));

    const res = await createDocumentRoute(
      apiRequest('http://localhost/api/documents', 'POST', {
        ...VALID_DOCUMENT,
        customer_id: FOREIGN_ID,
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'El cliente no pertenece a tu sucursal' });
  });

  it('rechaza vincular un documento con el pedido de B', async () => {
    supabaseMock.__queue('purchase_orders', rowOfB({ id: FOREIGN_ID }));

    const res = await createDocumentRoute(
      apiRequest('http://localhost/api/documents', 'POST', {
        ...VALID_DOCUMENT,
        purchase_order_id: FOREIGN_ID,
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'La orden de compra no pertenece a tu sucursal' });
  });
});

describe('compras', () => {
  it('rechaza un pedido que apunta al proveedor de B', async () => {
    // El `supplier_id` viene del body. Si no se valida contra el tenant, el
    // pedido de A queda clavado al proveedor de B y el listado lo resuelve con
    // un join sin filtro, mostrando el nombre de B.
    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue('products', {
      data: [{ id: 'prod-a', name: 'Producto de A', cost: 10, cost_cents: 1000 }],
      error: null,
    });
    supabaseMock.__queue('providers', rowOfB({ id: FOREIGN_ID, name: NAME_OF_B }));
    supabaseMock.__queue('suppliers', rowOfB({ id: FOREIGN_ID, name: NAME_OF_B }));
    supabaseMock.__queue('purchase_orders', {
      data: { id: 'po-1', tenant_id: TENANT_A },
      error: null,
    });
    supabaseMock.__queue('purchase_order_items', { data: null, error: null });

    const res = await createPurchaseOrderRoute(
      apiRequest('http://localhost/api/purchase-orders', 'POST', {
        supplier_id: FOREIGN_ID,
        items: [{ product_id: 'prod-a', quantity: 1, unit_cost: 10 }],
      })
    );

    expect(res.status).not.toBe(201);
    expect(writesTo(supabaseMock.__calls, 'purchase_orders')).toHaveLength(0);
    // Tampoco puede sembrar un `providers` con el id que le dictaron.
    expect(JSON.stringify(callsTo(supabaseMock.__calls, 'providers', 'insert'))).not.toContain(
      FOREIGN_ID
    );
  });

  it('el listado de A no incluye pedidos de B', async () => {
    supabaseMock.__queue('purchase_orders', rowOfB({ id: FOREIGN_ID, total_cents: 31337 }));

    const res = await listPurchaseOrdersRoute(
      apiRequest('http://localhost/api/purchase-orders', 'GET')
    );

    expect(await res.text()).not.toContain('31337');
  });
});
