import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { createCreditNote } from '@/lib/arca-service';
import { fixResponse } from '@/lib/utils/encoding';

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await props.params;
  const result = await createCreditNote(auth, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(fixResponse(result.data), { status: result.status });
}
