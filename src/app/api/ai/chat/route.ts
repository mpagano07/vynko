import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { sendChatQuery } from '@/lib/ai-service';

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { message } = await request.json();

  const result = await sendChatQuery(auth, message);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: result.headers });
  return NextResponse.json(result.data);
}