import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { deleteAccount } from '@/lib/account-service';
import { logger } from '@/lib/logger';

export async function DELETE(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { confirm?: unknown };
  try {
    body = (await request.json()) as { confirm?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const result = await deleteAccount(auth, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  logger.info('Cuenta eliminada por autoservicio', { userId: auth.userId });
  return NextResponse.json(result.data);
}
