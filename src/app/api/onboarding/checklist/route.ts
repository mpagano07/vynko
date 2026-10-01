import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { setChecklistDismissed } from '@/lib/onboarding-checklist-service';

export async function PATCH(request: Request) {
  // `getAuth` ya rechaza origenes ajenos (CSRF) y exige sesion.
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { dismissed?: unknown };
  try {
    body = (await request.json()) as { dismissed?: unknown };
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  if (typeof body.dismissed !== 'boolean') {
    return NextResponse.json({ error: 'dismissed debe ser boolean' }, { status: 400 });
  }

  const result = await setChecklistDismissed(auth, body.dismissed);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ dismissed: result.dismissed });
}