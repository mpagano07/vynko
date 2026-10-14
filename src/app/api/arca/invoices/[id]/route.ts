import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getElectronicInvoiceById } from '@/lib/arca-service';
import { fixResponse } from '@/lib/utils/encoding';

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await props.params;
  const result = await getElectronicInvoiceById(auth, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(fixResponse(result.data));
}
