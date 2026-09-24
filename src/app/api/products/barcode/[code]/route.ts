import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { lookupProductByCode } from '@/lib/product-service';
import { fixResponse } from '@/lib/utils/encoding';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const auth = await getAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const result = await lookupProductByCode(auth, code);
    if (!result.ok) {
      return NextResponse.json({ error: 'Ocurrio un error inesperado. Intenta de nuevo.' }, { status: 500 });
    }
    return NextResponse.json(fixResponse({ product: result.product }));
  } catch (err) {
    console.error('Error in barcode lookup:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}