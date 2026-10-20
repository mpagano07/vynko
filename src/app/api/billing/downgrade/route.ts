import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase';
import { downgradePlan } from '@/lib/billing-service';
import type { PlanId } from '@/lib/plans';
import { isSameOriginRequest } from '@/lib/security/csrf';

const DowngradeSchema = z.object({
  plan: z.enum(['starter', 'free']),
});

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const parsed = DowngradeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Plan inválido' }, { status: 400 });
  }

  const result = await downgradePlan(user, parsed.data.plan as PlanId, request);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}