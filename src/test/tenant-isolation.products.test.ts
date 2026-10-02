import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from '@/test/supabase-mock';
import {
  FOREIGN_ID,
  TENANT_B,
  apiRequest,
  barcodeParams,
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

import { GET as lookupByBarcode } from '@/app/api/products/barcode/[code]/route';
import { PATCH as updateProductRoute } from '@/app/api/products/[id]/route';
import { POST as createProductRoute } from '@/app/api/products/route';
import { signProductImageUrls } from '@/lib/upload-service';

// Un producto de la Empresa B con stock de la Empresa B. `products` es una tabla
// global (no tiene tenant_id), asi que el unico aislamiento posible es exigir
// que el producto tenga fila en `product_stock` de la Empresa A.
const PRODUCT_OF_B = {
  id: FOREIGN_ID,
  name: 'Cupon secreto de B',
  sku: 'SKU-B',
  barcode: 'BARCODE-B',
  cost: 999,
  price: 1500,
  cost_cents: 99900,
  price_cents: 150000,
  image_storage_path: `${TENANT_B}/11111111-2222-3333-4444-555555555555.png`,
};

beforeEach(() => {
  supabaseMock.__reset();
  // Sin esto el mock devuelve cualquier fila en cola aunque el servicio no
  // filtre por tenant, que es justo lo que estos tests tienen que detectar.
  supabaseMock.__setTenantAware(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('productos: Empresa A no alcanza el catalogo de la Empresa B', () => {
  it('no resuelve por codigo de barras un producto que solo tiene stock en B', async () => {
    supabaseMock.__queue('products', { data: [PRODUCT_OF_B], error: null });
    supabaseMock.__queue('product_stock', {
      data: [{ product_id: FOREIGN_ID, tenant_id: TENANT_B, stock: 12, active: true }],
      error: null,
    });

    const res = await lookupByBarcode(
      apiRequest('http://localhost/api/products/barcode/BARCODE-B', 'GET'),
      barcodeParams('BARCODE-B')
    );
    const body = await res.json();

    expect(body.product).toBeNull();
    expect(JSON.stringify(body)).not.toContain('Cupon secreto de B');
    expect(JSON.stringify(body)).not.toContain('99900');
  });

  it('tampoco resuelve un producto de B por su id (mismo endpoint, otroLookup)', async () => {
    // El endpoint acepta codigo de barras o id. Los dos caminos tienen que
    // respetar el mismo aislamiento.
    supabaseMock.__queue('products', { data: [], error: null });
    supabaseMock.__queue('products', { data: [PRODUCT_OF_B], error: null });
    supabaseMock.__queue('product_stock', {
      data: [{ product_id: FOREIGN_ID, tenant_id: TENANT_B, stock: 12, active: true }],
      error: null,
    });

    const res = await lookupByBarcode(
      apiRequest(`http://localhost/api/products/barcode/${FOREIGN_ID}`, 'GET'),
      barcodeParams(FOREIGN_ID)
    );
    const body = await res.json();

    expect(body.product).toBeNull();
    expect(JSON.stringify(body)).not.toContain('Cupon secreto de B');
  });

  it('no filtra el costo de B en el error de stock insuficiente', async () => {
    // Un producto que A no deberia ni conocer llega hasta el calculo de stock.
    supabaseMock.__queue('products', { data: [PRODUCT_OF_B], error: null });
    supabaseMock.__queue('product_stock', { data: [], error: null });

    const res = await lookupByBarcode(
      apiRequest('http://localhost/api/products/barcode/BARCODE-B', 'GET'),
      barcodeParams('BARCODE-B')
    );

    expect(await res.json()).toEqual({ product: null });
  });

  it('rechaza editar un producto sobre el que A no tiene stock', async () => {
    // `updateProduct` exige pertenencia en product_stock antes de escribir.
    supabaseMock.__queue('product_stock', {
      data: [{ product_id: FOREIGN_ID, tenant_id: TENANT_B }],
      error: null,
    });

    const res = await updateProductRoute(
      apiRequest(`http://localhost/api/products/${FOREIGN_ID}`, 'PATCH', { name: 'Secuestrado' }),
      routeParams(FOREIGN_ID)
    );

    expect(res.status).toBe(403);
    expect(writesTo(supabaseMock.__calls, 'products')).toHaveLength(0);
  });

  it('no guarda una image_url que apunta al storage de otro tenant', async () => {
    // `products` es global: escribir ahi la URL de B la deja publicada para
    // todos, y `signProductImageUrls` la convierte en una signed URL servida
    // con la service role.
    const foreignUrl =
      `https://proyecto.supabase.co/storage/v1/object/public/product-images/` +
      `${TENANT_B}/11111111-2222-3333-4444-555555555555.png`;

    supabaseMock.__queue('tenant_users', { data: { role: 'owner' }, error: null });
    supabaseMock.__queue('tenants', {
      data: { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', subscription_plan: 'business' },
      error: null,
    });
    supabaseMock.__queue('product_stock', { data: [], error: null });
    supabaseMock.__queue('products', {
      data: { id: 'new-1', name: 'Producto de A', image_url: foreignUrl },
      error: null,
    });
    supabaseMock.__queue('product_stock', { data: { id: 'stock-1' }, error: null });

    const res = await createProductRoute(
      apiRequest('http://localhost/api/products', 'POST', {
        name: 'Producto de A',
        image_url: foreignUrl,
      })
    );

    expect(res.status).toBe(201);
    const insert = callsTo(supabaseMock.__calls, 'products', 'insert')[0];
    expect(JSON.stringify(insert?.args[0])).not.toContain(TENANT_B);
  });

  it('no firma una URL de imagen que pertenece a otro tenant', async () => {
    const foreignUrl =
      `https://proyecto.supabase.co/storage/v1/object/public/product-images/` +
      `${TENANT_B}/11111111-2222-3333-4444-555555555555.png`;

    supabaseMock.__storageResults.createSignedUrls = {
      data: [
        {
          path: `${TENANT_B}/11111111-2222-3333-4444-555555555555.png`,
          signedUrl: 'https://firma.example/imagen-de-b.png',
        },
      ],
      error: null,
    };

    const [product] = await signProductImageUrls(
      [{ id: 'p1', name: 'Producto de A', image_url: foreignUrl }],
      'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
    );

    expect(product.image_url).not.toContain('imagen-de-b.png');
  });

  it('sigue firmando la imagen propia del tenant', async () => {
    // El caso anterior no se resuelve descartando todo: A tiene que poder ver
    // las imagenes que subio a su propio folder.
    const ownPath = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/99999999-8888-7777-6666-555555555555.png';
    supabaseMock.__storageResults.createSignedUrls = {
      data: [{ path: ownPath, signedUrl: 'https://firma.example/mia.png' }],
      error: null,
    };

    const [product] = await signProductImageUrls(
      [{ id: 'p1', name: 'Producto de A', image_storage_path: ownPath }],
      'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
    );

    expect(product.image_url).toBe('https://firma.example/mia.png');
  });
});

describe('productos: las consultas del tenant se acotan a su propia empresa', () => {
  it('el filtro de product_stock siempre incluye el tenant activo', async () => {
    supabaseMock.__queue('products', { data: [PRODUCT_OF_B], error: null });
    supabaseMock.__queue('product_stock', { data: [], error: null });

    await lookupByBarcode(
      apiRequest('http://localhost/api/products/barcode/BARCODE-B', 'GET'),
      barcodeParams('BARCODE-B')
    );

    const stockQuery = callsTo(supabaseMock.__calls, 'product_stock');
    expect(stockQuery.length).toBeGreaterThan(0);
    const tenantPredicates = stockQuery.filter((call) => call.method === 'eq' && call.args[0] === 'tenant_id');
    expect(tenantPredicates.length).toBeGreaterThan(0);
  });
});
