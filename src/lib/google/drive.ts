import { getGoogleDriveAccessToken } from './token-store';

export async function getGoogleAccessToken(userId: string): Promise<string | null> {
  const token = await getGoogleDriveAccessToken(userId);
  return token?.accessToken ?? null;
}

export async function downloadDriveFile(
  fileId: string,
  accessToken: string
): Promise<{ buffer: ArrayBuffer; mimeType: string; name: string }> {
  // Get file metadata
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!metaRes.ok) {
    throw new Error('No se pudo obtener la información del archivo');
  }

  const meta = await metaRes.json();

  // Download file content
  const downloadRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!downloadRes.ok) {
    throw new Error('No se pudo descargar el archivo desde Google Drive');
  }

  const buffer = await downloadRes.arrayBuffer();
  return {
    buffer,
    mimeType: meta.mimeType || downloadRes.headers.get('content-type') || '',
    name: meta.name || 'archivo',
  };
}

export async function uploadToDrive(options: {
  accessToken: string;
  name: string;
  mimeType: string;
  blob: Blob;
}): Promise<{ id: string; webViewLink?: string }> {
  const { accessToken, name, mimeType, blob } = options;

  const metadata = {
    name,
    mimeType,
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', blob);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    }
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`No se pudo guardar en Google Drive: ${error}`);
  }

  return res.json();
}
