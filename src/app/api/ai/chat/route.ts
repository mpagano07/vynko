import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { sendChatQuery } from '@/lib/ai-service';

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let message: unknown;
  try {
    const body = await request.json();
    message = (body as { message?: unknown } | null)?.message;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof message !== 'string') {
    return NextResponse.json({ error: 'Mensaje requerido' }, { status: 400 });
  }

  const result = await sendChatQuery(auth, message);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: result.headers });
  return NextResponse.json(result.data);
}