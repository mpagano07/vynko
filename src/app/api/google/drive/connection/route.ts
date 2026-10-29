import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { isGoogleDriveConnected, revokeGoogleDriveConnection } from '@/lib/google/token-store';
import { logger } from '@/lib/logger';

export async function GET(request: Request) {
  const auth = await getAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const connected = await isGoogleDriveConnected(auth.userId);
  return NextResponse.json(
    { connected },
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
