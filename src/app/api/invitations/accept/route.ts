import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { acceptInvitationsForUser } from '@/lib/accept-invitations';

async function getAuthenticatedUser(request: Request) {
  const authHeader = request.headers.get('authorization');
  const refreshToken = request.headers.get('x-refresh-token');

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const authClient = await createServerSupabaseClient();

    const { data: sessionData, error: sessionError } = await authClient.auth.setSession({
      access_token: token,
      refresh_token: refreshToken ?? '',
    });
    if (!sessionData?.session || sessionError) {
      return null;
    }

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) {
      return null;
    }

    return userData.user;
  }

  const authClient = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return null;
  }

  return user;
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user || !user.email) {
      return NextResponse.json({ accepted: 0 });
    }

    const { accepted } = await acceptInvitationsForUser({ id: user.id, email: user.email });

    return NextResponse.json({ accepted });
  } catch (err) {
    console.error('Error accepting invitations:', err);
    return NextResponse.json({ accepted: 0 }, { status: 500 });
  }
}
