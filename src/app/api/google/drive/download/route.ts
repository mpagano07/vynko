import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { downloadDriveFile, getGoogleAccessToken } from '@/lib/google/drive';
import { validateSpreadsheetFile, MAX_IMPORT_BYTES } from '@/lib/excel-import-parse';

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const fileId = body?.fileId;

    if (!fileId) {
      return NextResponse.json({ error: 'fileId requerido' }, { status: 400 });
    }

    const accessToken = await getGoogleAccessToken(auth.userId);
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Conectá tu cuenta de Google con permisos de Drive', needsAuth: true },
        { status: 403 }
      );
    }

    const { buffer, mimeType, name } = await downloadDriveFile(fileId, accessToken);

    if (buffer.byteLength === 0) {
      return NextResponse.json({ error: 'Archivo vacío' }, { status: 400 });
    }

    if (buffer.byteLength > MAX_IMPORT_BYTES) {
      return NextResponse.json(
        { error: 'El archivo supera los 10MB' },
        { status: 413 }
      );
    }

    const check = validateSpreadsheetFile({ name, size: buffer.byteLength });
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }

    // Return file as base64 for client to process
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    return NextResponse.json({
      fileName: name,
      mimeType,
      data: base64,
      size: buffer.byteLength,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al descargar archivo' },
      { status: 500 }
    );
  }
}
