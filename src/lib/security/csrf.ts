const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Orígenes aceptables para la request: el que declara el proxy
 * (x-forwarded-host/proto) y el de la propia URL de la request. Se aceptan
 * ambos porque en desarrollo no siempre llega x-forwarded-proto, y `https` por
 * defecto haría que todo POST local fuera tomado como cross-site.
 */
function addOrigin(origins: Set<string>, value: string | null | undefined): void {
  const raw = (value ?? '').trim();
  if (!raw) return;
  try {
    origins.add(new URL(raw).origin);
  } catch {
    // Valor inválido: se ignora.
  }
}

function getRequestOrigins(request: Request): Set<string> {
  const origins = new Set<string>();

  try {
    origins.add(new URL(request.url).origin);
  } catch {
    // URL inválida: sólo queda el origen de headers.
  }

  // El origen público configurado. Detrás de un proxy que reescribe el host
  // (o cuando `request.url` refleja un host interno) el Origin del navegador
  // puede no coincidir con la URL del request aunque la petición sea legítima.
  // Aceptar el sitio configurado no debilita el control: un atacante no puede
  // falsificar el header `Origin` desde su propio dominio.
  addOrigin(origins, process.env.NEXT_PUBLIC_SITE_URL);
  addOrigin(origins, process.env.NEXT_PUBLIC_APP_URL);

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

  // `cross-site` es concluyente. `same-site` NO: para el navegador dos
  // subdominios distintos son same-site (app.test y evil.app.test), y confiar en
  // ese valor dejaba pasar un POST desde un subdominio comprometido. Por eso
  // same-site solo se acepta si además el Origin coincide exactamente con uno de
  // los orígenes permitidos.
  if (fetchSite === 'cross-site') return true;

  const origin = request.headers.get('origin');
  // `Origin: null` lo envían los navegadores desde contextos opacos (sandboxed
  // iframes, data:/file: y algunos redirects). Nunca es same-origin, así que se
  // trata como cross-site. La ausencia total del header se permite para clientes
  // no-navegador (curl, apps móviles, webhooks), que no son susceptibles a CSRF
  // vía navegador. La excepción es same-site sin Origin: es una combinación que
  // no podemos atribuir a un origen concreto, así que se rechaza.
  if (!origin) return fetchSite === 'same-site';
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
