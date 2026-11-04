/**
 * Rescate de los magic links de invitación que Supabase manda al Site URL.
 *
 * `redirect_to` sólo se respeta si la URL está en la allowlist del proyecto.
 * Si no lo está, GoTrue colapsa el destino a `https://vynko.dev` y deja la
 * sesión en el fragmento (`#access_token=...&type=magiclink`). El servidor no
 * ve ese fragmento, así que sin rescate el invitado queda en la home sin
 * sesión y cree que el link no funcionó.
 *
 * El rescate se hace con un script inline en el `<head>` (ver
 * `buildMagicLinkRescueScript`) y no sólo con un `useEffect`: en una carga fría
 * el bundle puede tardar decenas de segundos en hidratar, y hasta entonces el
 * usuario ve la home (o el login) como si el link no hubiera hecho nada. El
 * script corre mientras se parsea el documento, antes de descargar React.
 */

export const MAGIC_PATH = '/auth/magic';

/** Tipos de link que traen una sesión de invitación en el fragmento. */
export const INVITATION_TYPES = ['invite', 'magiclink', 'signup'] as const;

const INVITATION_TYPE_SET = new Set<string>(INVITATION_TYPES);

/**
 * Devuelve la URL de canje cuando el fragmento trae una sesión de invitación,
 * o `null` si no hay nada que rescatar.
 *
 * No toca los links de recuperación de contraseña (flujo PKCE con `?code`) ni
 * el flujo implícito de recuperación (`type=recovery`).
 */
export function magicRedirectTarget(hash: string): string | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const type = params.get('type') ?? '';
  const hasSession = Boolean(params.get('access_token') && params.get('refresh_token'));

  if (!hasSession || !INVITATION_TYPE_SET.has(type)) return null;
  return `${MAGIC_PATH}#${raw}`;
}

/**
 * Cuerpo del script que rescata el link antes de hidratar.
 *
 * Es la misma regla que `magicRedirectTarget`, pero escrita para ejecutarse sin
 * dependencias. Se mantiene corta a propósito: viaja inline en cada respuesta
 * HTML dinámica.
 */
export function buildMagicLinkRescueScript(): string {
  const types = JSON.stringify(INVITATION_TYPES);
  return (
    '(function(){try{' +
    `var types=${types},path=${JSON.stringify(MAGIC_PATH)};` +
    'if(window.location.pathname===path)return;' +
    "var hash=window.location.hash;if(!hash||hash.length<2)return;" +
    'var params=new URLSearchParams(hash.slice(1));' +
    "if(!params.get('access_token')||!params.get('refresh_token'))return;" +
    'if(types.indexOf(params.get("type"))<0)return;' +
    'window.location.replace(path+hash);' +
    '}catch(e){}})();'
  );
}
