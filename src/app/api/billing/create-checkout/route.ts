import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase';
import { createCheckoutSession } from '@/lib/billing-service';
import { isSameOriginRequest } from '@/lib/security/csrf';

const CreateCheckoutSchema = z.object({
  plan: z.enum(['starter', 'business']).nullable().optional(),
});

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const parsed = CreateCheckoutSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const result = await createCheckoutSession(
    user,
    parsed.data as { plan?: string | null },
    request
  );
  if (!result.ok) return NextResponse.json({ error: result.error, ...(result.needsSalesContact ? { needsSalesContact: true } : {}) }, { status: result.status });
  return NextResponse.json(result.data);
}