import { NextResponse } from 'next/server';
import { getSessionData } from '@/lib/session-service';

export async function GET(request: Request) {
  try {
    const result = await getSessionData(request);
    return NextResponse.json(result.data);
  } catch (error) {
    console.error('Error in GET /api/session:', error);
    return NextResponse.json(
      { user: null, profile: null, tenant: null, tenants: [], onboarding_pending: true, error: 'Internal server error' },
      { status: 500 }
    );
  }
}