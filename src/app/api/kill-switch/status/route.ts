import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getKillSwitchEnvOverrides, getKillSwitchState } from '@/lib/kill-switch';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Estado de los kill switches para el banner de la app.
 *
 * Va separado de `/api/session` a proposito: la sesion se revalida cada 5
 * minutos, asi que un flag matado hoy tardaria eso en reflejarse en la UI. El
 * hook `useKillSwitches` lo consulta cada 15 s.
 */
export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const kill_switches = await getKillSwitchState();
    const env_overrides = getKillSwitchEnvOverrides();
    return NextResponse.json(
      { kill_switches, env_overrides },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    logger.error('GET /api/kill-switch/status fallo', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
