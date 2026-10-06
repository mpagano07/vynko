import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

function getVersion(): string {
  return (
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.SOURCE_VERSION ||
    'dev'
  );
}

const noStore = { 'Cache-Control': 'no-store, max-age=0' } as const;

// Liveness por defecto: responde 200 aunque el polling de DB falle una vez.
// Readiness: `GET /api/health?check=db` hace un ping real a Supabase con el
// service role y devuelve 503 si la base no responde, para que un monitor
// (Vercel Cron, uptime check) alerta cuando la app no puede leer/escribir.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = {
    status: 'ok' as const,
    version: getVersion(),
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
  };

  if (url.searchParams.get('check') !== 'db') {
    return NextResponse.json(base, { headers: noStore });
  }

  const { error } = await supabaseAdmin
    .from('tenants')
    .select('id', { head: true, count: 'exact' });

  if (error) {
    return NextResponse.json(
      { ...base, status: 'degraded', checks: { database: 'error' } },
      { status: 503, headers: noStore }
    );
  }

  return NextResponse.json(
    { ...base, checks: { database: 'ok' } },
    { headers: noStore }
  );
}