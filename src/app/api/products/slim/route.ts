import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { listProductsSlim } from '@/lib/product-service';
import { fixResponse } from '@/lib/utils/encoding';

export const dynamic = 'force-dynamic';

/**
 * Catálogo slim (id, name, sku, barcode, price, stock, min_stock) del tenant
 * activo.
 *
 * Igual que `GET /api/products` respeta el header `x-active-tenant-id`, así
 * que un picker puede pedir el catálogo de OTRA sucursal propia sin traer el
 * resto de las columnas ni firmar imágenes. Lo usan el selector de
 * transferencias y el POS de ventas.
 */
export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const result = await listProductsSlim(auth);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(fixResponse(result.products));
}
