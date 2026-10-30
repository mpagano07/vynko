import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { logger } from '@/lib/logger';
import { decryptGoogleToken, encryptGoogleToken } from './token-crypto';
import { hasDriveFileScope } from './oauth';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

interface StoredTokenRow {
  refresh_token_encrypted: string;
  refresh_token_iv: string;
  refresh_token_tag: string;
  scope: string | null;
}

export interface GoogleDriveAccessToken {
  accessToken: string;
  expiresAt: number;
}

function getClientCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || clientId === 'dummy' || clientSecret === 'dummy') {
    return null;
  }
  return { clientId, clientSecret };
}

/** Guarda (o reemplaza) el refresh token del usuario conectado. */
export async function saveGoogleDriveRefreshToken(
  userId: string,
  refreshToken: string,
  scope?: string | null
): Promise<void> {
  const payload = encryptGoogleToken(refreshToken);
  const { error } = await supabaseAdmin.from('google_drive_tokens').upsert(
    {
      user_id: userId,
      refresh_token_encrypted: payload.encrypted,
      refresh_token_iv: payload.iv,
      refresh_token_tag: payload.tag,
      scope: scope ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    throw new Error(`No se pudo guardar la conexión con Google Drive: ${error.message}`);
  }
}

export async function deleteGoogleDriveRefreshToken(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('google_drive_tokens').delete().eq('user_id', userId);
  if (error) {
    logger.error('No se pudo borrar el token de Google Drive:', { error });
  }
}

/**
 * Indica si el usuario tiene una conexión utilizable con Drive.
 *
 * No alcanza con mirar la fila local: el usuario pudo revocar el acceso desde
 * su Cuenta de Google. Pedir un access token valida la conexión y, si ya no
 * sirve, `getGoogleDriveAccessToken` limpia la fila.
 */
export async function isGoogleDriveConnected(userId: string): Promise<boolean> {
  const token = await getGoogleDriveAccessToken(userId);
  return token !== null;
}

/**
 * Revoca el acceso a Drive en Google y borra el refresh token local.
 *
 * Borrar sólo la fila no alcanza: el permiso seguiría apareciendo en la
 * Cuenta de Google del usuario. Por eso se llama a /revoke con el refresh
 * token antes de limpiar la base.
 */
export async function revokeGoogleDriveConnection(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('google_drive_tokens')
    .select('refresh_token_encrypted, refresh_token_iv, refresh_token_tag, scope')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo leer la conexión con Google Drive: ${error.message}`);
  }
  if (!data) return;

  const row = data as StoredTokenRow;
  let refreshToken: string;
  try {
    refreshToken = decryptGoogleToken({
      encrypted: row.refresh_token_encrypted,
      iv: row.refresh_token_iv,
      tag: row.refresh_token_tag,
    });
  } catch (decryptError) {
    // La fila local ya no sirve para revocar nada; se limpia para que el
    // usuario pueda volver a conectar desde cero.
    logger.error('No se pudo descifrar el token de Drive para revocarlo:', { error: decryptError });
    await deleteGoogleDriveRefreshToken(userId);
    return;
  }

  let response: Response;
  try {
    response = await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
      cache: 'no-store',
    });
  } catch (fetchError) {
    logger.error('Error de red al revocar el token de Google Drive:', { error: fetchError });
    throw new Error('No se pudo revocar el acceso a Google Drive. Intentá de nuevo.');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    // `invalid_token` significa que Google ya no reconoce el token: el acceso
    // ya está revocado, así que se puede limpiar la fila igual.
    if (body?.error !== 'invalid_token') {
      logger.error('Google rechazó la revocación del token de Drive:', {
        error: body?.error ?? response.status,
      });
      throw new Error('Google rechazó la revocación del acceso. Intentá de nuevo.');
    }
  }

  const { error: deleteError } = await supabaseAdmin
    .from('google_drive_tokens')
    .delete()
    .eq('user_id', userId);
  if (deleteError) {
    logger.error('No se pudo borrar el token de Drive después de revocarlo:', { error: deleteError });
    throw new Error('Se revocó el acceso en Google, pero no se pudo limpiar la conexión local.');
  }
}

/**
 * Devuelve un access token vigente para Google Drive.
 *
 * Canjea el refresh token guardado en cada llamada: son pocas (abrir el Picker,
 * descargar o subir un archivo) y así nunca queda un access token viejo en la
 * base. Si Google responde `invalid_grant` (el usuario revocó el acceso),
 * borramos la fila para que el cliente vuelva a pedir autorización.
 */
export async function getGoogleDriveAccessToken(
  userId: string
): Promise<GoogleDriveAccessToken | null> {
  const { data, error } = await supabaseAdmin
    .from('google_drive_tokens')
    .select('refresh_token_encrypted, refresh_token_iv, refresh_token_tag, scope')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logger.error('No se pudo leer el token de Google Drive:', { error });
    return null;
  }
  if (!data) return null;

  const row = data as StoredTokenRow;
  if (!hasDriveFileScope(row.scope)) {
    // Conexiones hechas antes de pedir sólo `drive.file` (o con el permiso
    // destildado) no sirven para Picker/Drive. Se borran para que el cliente
    // vuelva a autorizar en vez de fallar con 401/403 en cada intento.
    logger.warn('Token de Google Drive sin el scope drive.file; se reconecta.', {
      scope: row.scope,
    });
    await deleteGoogleDriveRefreshToken(userId);
    return null;
  }
  let refreshToken: string;
  try {
    refreshToken = decryptGoogleToken({
      encrypted: row.refresh_token_encrypted,
      iv: row.refresh_token_iv,
      tag: row.refresh_token_tag,
    });
  } catch (decryptError) {
    // Clave de cifrado rotada o fila corrupta: la única salida es reconectar.
    logger.error('No se pudo descifrar el token de Google Drive:', { error: decryptError });
    return null;
  }

  const credentials = getClientCredentials();
  if (!credentials) {
    logger.error('Google OAuth no está configurado para refrescar el token de Drive.');
    return null;
  }

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      cache: 'no-store',
    });
  } catch (fetchError) {
    logger.error('Error de red al refrescar el token de Google Drive:', { error: fetchError });
    return null;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === 'invalid_grant') {
      await deleteGoogleDriveRefreshToken(userId);
    } else {
      logger.error('Google rechazó el refresh token de Drive:', {
        error: body?.error ?? response.status,
      });
    }
    return null;
  }

  const tokens = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!tokens.access_token) return null;

  return {
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
}
