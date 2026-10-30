import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { getGoogleDriveAccessToken, revokeGoogleDriveConnection } from '@/lib/google/token-store';
import { getDriveAccount } from '@/lib/google/drive';
import { logger } from '@/lib/logger';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  // Además de "conectado", se devuelve la cuenta vinculada: es la única forma
  // de que el usuario detecte que autorizó un Google distinto del que usa.
  const token = await getGoogleDriveAccessToken(auth.userId);
  if (!token) {
    return NextResponse.json(
      { connected: false, email: null },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const account = await getDriveAccount(token.accessToken).catch(() => null);

  return NextResponse.json(
    { connected: true, email: account?.emailAddress ?? null },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function DELETE(request: Request) {
  const auth = await getAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  try {
    await revokeGoogleDriveConnection(auth.userId);
    logger.info('Conexión con Google Drive revocada por el usuario');
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logger.error('No se pudo desconectar Google Drive:', { error });
    return NextResponse.json(
      { error: 'No se pudo desconectar Google Drive. Intentá de nuevo.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
