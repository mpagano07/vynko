import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-guard';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { setFeatureFlag } from '@/lib/feature-flags';
import { invalidateKillSwitchCache } from '@/lib/kill-switch';
import { KILL_SWITCH_FLAG_KEYS } from '@/lib/kill-switch-config';
import { logger } from '@/lib/logger';

/**
 * Kill switches del panel de incidentes (`/admin/ops`).
 *
 * Vive separado de `/api/admin/feature-flags` a propósito: prender un kill
 * switch corta una función en producción y tiene que pasar por el flujo con
 * confirmación del panel, no por el editor genérico de flags. La ruta genérica
 * rechaza cualquier clave `kill_*`/`maintenance_mode`, así que este es el único
 * camino de escritura.
 *
 * Sólo se aceptan las áreas conocidas: un `kill_typo` no lo lee nadie, pero
 * contamina la tabla y hace creer que hay un corte activo.
 */

const OPS_FLAG_KEYS = new Set<string>(Object.values(KILL_SWITCH_FLAG_KEYS));

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

  const input = body as { flag_key?: unknown; enabled?: unknown };

  if (typeof input.flag_key !== 'string' || !OPS_FLAG_KEYS.has(input.flag_key)) {
    return NextResponse.json({ error: 'Kill switch inválido' }, { status: 400 });
  }
  if (typeof input.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled tiene que ser booleano' }, { status: 400 });
  }

  const result = await setFeatureFlag({
    flag_key: input.flag_key,
    enabled: input.enabled,
    // Los kill switches no usan rollout: `enabled` es la única señal.
    rollout_percent: 100,
    updated_by: admin.userId,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  // El cache propio (10 s) sirve el estado viejo hasta que vence.
  invalidateKillSwitchCache();

  logger.info('kill switch actualizado', {
    flag: result.flag.flag_key,
    enabled: result.flag.enabled,
    updated_by: admin.userId,
  });

  return NextResponse.json({ flag: result.flag });
}
