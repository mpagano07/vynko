import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { listFeatureFlags, setFeatureFlag } from '@/lib/feature-flags';
import { invalidateKillSwitchCache } from '@/lib/kill-switch';
import { logger } from '@/lib/logger';

/**
 * Feature flags: solo lectura/escritura para admin (fail closed, igual que
 * `/api/admin/analytics`: el flag `profiles.is_admin` se resuelve con service
 * role y no se acepta nada venga de la sesion del cliente).
 *
 * No es un CRUD generico a proposito: un flag se crea con la forma validada de
 * aca o en una migracion, no con cualquier objeto.
 *
 * Los kill switches tienen su propia ruta (`/api/admin/kill-switches`) porque
 * cortan producción y pasan por el flujo con confirmación de `/admin/ops`.
 * Aceptarlos acá permitiría prenderlos desde el editor genérico sin ese paso.
 */

const FLAG_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Claves reservadas a `/api/admin/kill-switches`. */
function isKillSwitchKey(flagKey: string): boolean {
  return flagKey.startsWith('kill_') || flagKey === 'maintenance_mode';
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
  if (isKillSwitchKey(input.flag_key)) {
    return NextResponse.json(
      { error: 'Los kill switches se administran desde /admin/ops' },
      { status: 400 }
    );
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

  // El cache de kill switches es propio (10 s). Sin esto, la instancia que
  // atiende el PUT seguiria sirviendo el estado viejo hasta que venza.
  invalidateKillSwitchCache();

  logger.info('feature flag actualizado', {
    flag: result.flag.flag_key,
    enabled: result.flag.enabled,
    rollout_percent: result.flag.rollout_percent,
    updated_by: admin.userId,
  });

  return NextResponse.json({ flag: result.flag });
}
