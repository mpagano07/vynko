import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase';
import { cancelSubscription } from '@/lib/billing-service';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { guardKill } from '@/lib/kill-switch';
import { CANCEL_REASON_IDS } from '@/lib/billing/cancel-reasons';

/**
 * El motivo es opcional y lo elige el modal de retención. Se valida contra la
 * lista cerrada para no guardar texto libre (PII) ni valores inventados.
 */
const CancelSchema = z.object({
  reason: z.enum(CANCEL_REASON_IDS).nullish(),
});

export async function POST(request: Request) {
  const killed = await guardKill('payments');
  if (killed) return killed;

  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // Compatibilidad: el cliente viejo cancelaba sin body. Un body inválido en
  // cambio se rechaza, porque indicaría un bug del cliente o un intento de
  // inyectar un motivo que no existe.
  let body: unknown = {};
  const rawBody = await request.text();
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
  }

  const parsed = CancelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Motivo inválido' }, { status: 400 });
  }

  const result = await cancelSubscription(user.id, parsed.data.reason ?? null);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}