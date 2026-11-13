import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getReleaseToken } from '@/lib/release-version';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store, max-age=0' } as const;

// Un ping de readiness que se cuelga es tan malo como uno que falla: el monitor
// espera hasta su propio timeout y la alerta llega tarde. 5 s es holgado para
// una lectura de una fila con el service role, y deja margen para el timeout
// del monitor (que conviene configurar en 10 s con 2 fallos consecutivos, para
// no alertar por una latencia puntual).
const READINESS_TIMEOUT_MS = 5_000;

// Liveness por defecto: responde 200 aunque el polling de DB falle una vez.
// Readiness: `GET /api/health?check=db` hace un ping real a Supabase con el
// service role y devuelve 503 si la base no responde, para que un monitor
// (Vercel Cron, uptime check) alerta cuando la app no puede leer/escribir.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = {
    status: 'ok' as const,
    // Token opaco del deploy, no el SHA: es público y no aporta diagnóstico.
    release: getReleaseToken(),
    timestamp: new Date().toISOString(),
  };

  if (url.searchParams.get('check') !== 'db') {
    return NextResponse.json(base, { headers: noStore });
  }

  // `head: true` + `limit(1)` es solo un "¿la DB responde?": no hace falta
  // contar filas (`count: 'exact'` recorre la tabla) ni traer datos.
  const { error } = await supabaseAdmin
    .from('tenants')
    .select('id', { head: true })
    .limit(1)
    .abortSignal(AbortSignal.timeout(READINESS_TIMEOUT_MS));

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