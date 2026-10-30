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

export interface UploadedDriveFile {
  id: string;
  name: string;
  webViewLink?: string;
}

export interface GoogleDriveAccount {
  emailAddress: string | null;
  displayName: string | null;
}

/**
 * Cuenta de Google vinculada al token.
 *
 * La exportación la usa para mostrar en qué Drive quedó el archivo: si el
 * usuario conectó una cuenta distinta de la que mira en el navegador, el
 * archivo existe pero no aparece en "Mi unidad".
 */
export async function getDriveAccount(accessToken: string): Promise<GoogleDriveAccount | null> {
  const res = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }
  );

  if (!res.ok) return null;

  const data = (await res.json().catch(() => null)) as {
    user?: { emailAddress?: string; displayName?: string };
  } | null;

  return {
    emailAddress: data?.user?.emailAddress ?? null,
    displayName: data?.user?.displayName ?? null,
  };
}

/**
 * Sube un archivo a la raíz de "Mi unidad" del usuario.
 *
 * `uploadType=multipart` exige un body `multipart/related` (no
 * `multipart/form-data`, que es lo que genera `FormData`). Si se manda el
 * formato equivocado Google puede crear el archivo sin leer el metadata: queda
 * sin nombre y sin carpeta padre, accesible sólo por link y sin aparecer en
 * "Mi unidad". Por eso se arma el body a mano y se declara `parents` explícito.
 */
export async function uploadToDrive(options: {
  accessToken: string;
  name: string;
  mimeType: string;
  blob: Blob;
  parentId?: string;
}): Promise<UploadedDriveFile> {
  const { accessToken, name, blob, parentId = 'root' } = options;
  // El mimeType del Blob puede traer parámetros ("text/csv;charset=utf-8") y
  // el metadata de Drive espera sólo el tipo.
  const mimeType = options.mimeType.split(';')[0].trim() || 'application/octet-stream';

  const boundary = `vynko_${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name, mimeType, parents: [parentId] });
  const fileBytes = new Uint8Array(await blob.arrayBuffer());
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + fileBytes.length + tail.length);
  body.set(head, 0);
  body.set(fileBytes, head.length);
  body.set(tail, head.length + fileBytes.length);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,parents',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary="${boundary}"`,
      },
      body,
    }
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`No se pudo guardar en Google Drive: ${error}`);
  }

  const created = (await res.json()) as { id: string; name?: string; webViewLink?: string };
  return {
    id: created.id,
    name: created.name ?? name,
    webViewLink: created.webViewLink,
  };
}
