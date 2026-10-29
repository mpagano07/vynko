import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/api-auth';
import { uploadToDrive, getGoogleAccessToken } from '@/lib/google/drive';

export async function POST(request: Request) {
  const auth = await getAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const fileName = formData.get('fileName') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 });
    }

    const accessToken = await getGoogleAccessToken(auth.userId);
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Conectá tu cuenta de Google con permisos de Drive', needsAuth: true },
        { status: 403 }
      );
    }

    const blob = new Blob([await file.arrayBuffer()], { type: file.type });
    const result = await uploadToDrive({
      accessToken,
      name: fileName || file.name,
      mimeType: file.type,
      blob,
    });

    return NextResponse.json({
      success: true,
      id: result.id,
      webViewLink: result.webViewLink,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al guardar en Drive' },
      { status: 500 }
    );
  }
}
