import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { revokeInvitation } from '@/lib/collaborator-service';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const result = await revokeInvitation(auth, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.body);
}
