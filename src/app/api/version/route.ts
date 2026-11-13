import { NextResponse } from 'next/server';
import { getReleaseToken } from '@/lib/release-version';

export const dynamic = 'force-dynamic';

/**
 * Token opaco del deploy. El cliente (`useAutoReload`) solo compara si cambió
 * para recargar cuando hay una versión nueva; no necesita el SHA.
 */
export async function GET() {
  return NextResponse.json(
    { version: getReleaseToken() },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
