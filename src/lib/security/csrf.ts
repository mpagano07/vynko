const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Orígenes aceptables para la request: el que declara el proxy
 * (x-forwarded-host/proto) y el de la propia URL de la request. Se aceptan
 * ambos porque en desarrollo no siempre llega x-forwarded-proto, y `https` por
 * defecto haría que todo POST local fuera tomado como cross-site.
 */
function getRequestOrigins(request: Request): Set<string> {
  const origins = new Set<string>();

  try {
    origins.add(new URL(request.url).origin);
  } catch {
    // URL inválida: sólo queda el origen de headers.
  }

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    const proto = request.headers.get('x-forwarded-proto');
    if (proto) {
      origins.add(`${proto.split(',')[0].trim()}://${host}`);
    }
  }

  return origins;
}

function hasForeignOrigin(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) return fetchSite === 'cross-site';

  const origin = request.headers.get('origin');
  // `Origin: null` lo envían los navegadores desde contextos opacos (sandboxed
  // iframes, data:/file: y algunos redirects). Nunca es same-origin, así que se
  // trata como cross-site. La ausencia total del header sí se permite: son
  // clientes no-navegador (curl, apps móviles, webhooks) que no son susceptibles
  // a CSRF vía navegador.
  if (!origin) return false;
  if (origin === 'null') return true;

  let requestOrigin: string;
  try {
    requestOrigin = new URL(origin).origin;
  } catch {
    return true;
  }

  return !getRequestOrigins(request).has(requestOrigin);
}

export function isCrossSiteRequest(request: Request): boolean {
  return hasForeignOrigin(request);
}

export function isSameOriginRequest(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  return !hasForeignOrigin(request);
}
