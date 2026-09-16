import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  const version =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.SOURCE_VERSION ||
    'dev';
  return NextResponse.json(
    { version },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}