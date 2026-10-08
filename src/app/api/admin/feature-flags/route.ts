import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isAdminProfile } from '@/lib/admin';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { listFeatureFlags, setFeatureFlag } from '@/lib/feature-flags';
import { logger } from '@/lib/logger';

/**
 * Feature flags: solo lectura/escritura para admin (fail closed, igual que
 * `/api/admin/analytics`: el flag `profiles.is_admin` se resuelve con service
 * role y no se acepta nada venga de la sesion del cliente).
 *
 * No es un CRUD generico a proposito: un flag se crea con la forma validada de
 * aca o en una migracion, no con cualquier objeto.
 */

const FLAG_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

async function requireAdmin(): Promise<{ userId: string } | NextResponse> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !isAdminProfile(profile)) {
    if (error) logger.error('Feature flags: no se pudo leer el perfil', { error: error.message });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return { userId: user.id };
}

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const flags = await listFeatureFlags();
  return NextResponse.json({ flags }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const input = body as {
    flag_key?: unknown;
    enabled?: unknown;
    rollout_percent?: unknown;
    description?: unknown;
  };

  if (typeof input.flag_key !== 'string' || !FLAG_KEY_PATTERN.test(input.flag_key)) {
    return NextResponse.json({ error: 'flag_key invalido' }, { status: 400 });
  }
  if (typeof input.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled tiene que ser booleano' }, { status: 400 });
  }
  if (
    typeof input.rollout_percent !== 'number' ||
    !Number.isInteger(input.rollout_percent) ||
    input.rollout_percent < 0 ||
    input.rollout_percent > 100
  ) {
    return NextResponse.json({ error: 'rollout_percent tiene que ser un entero entre 0 y 100' }, { status: 400 });
  }

  const result = await setFeatureFlag({
    flag_key: input.flag_key,
    enabled: input.enabled,
    rollout_percent: input.rollout_percent,
    description: typeof input.description === 'string' ? input.description : undefined,
    updated_by: admin.userId,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  logger.info('feature flag actualizado', {
    flag: result.flag.flag_key,
    enabled: result.flag.enabled,
    rollout_percent: result.flag.rollout_percent,
    updated_by: admin.userId,
  });

  return NextResponse.json({ flag: result.flag });
}
