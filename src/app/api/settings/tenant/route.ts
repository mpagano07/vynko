import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { updateTenantSettings } from '@/lib/settings-service';

export async function PATCH(request: Request) {
  try {
    const auth = await getAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();

    const result = await updateTenantSettings(auth, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data);
  } catch (err) {
    console.error('Error updating tenant:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}