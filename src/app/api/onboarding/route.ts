import { NextResponse } from 'next/server';
import { completeOnboarding } from '@/lib/onboarding-service';

export async function POST(request: Request) {
  const body = await request.json();

  const result = await completeOnboarding(request, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}