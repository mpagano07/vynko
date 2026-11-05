const INTERNAL_PREFIX = '/';
const HOST_PATTERN = /^[a-z0-9.-]+(:\d+)?$/i;

function originFromValue(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function configuredOrigin(): string | null {
  // En un Preview Deployment manda el host del request, no la URL canonica.
  // `NEXT_PUBLIC_SITE_URL` suele estar scopeada a produccion (o quedar con el
  // dominio real); usarla en un preview haria que el link de recuperacion
  // abierto desde una rama aterrice en el sitio productivo y que ese entorno
  // dispare sesiones contra datos reales.
  if (process.env.VERCEL_ENV === 'preview') return null;

  const configured = (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    ''
  ).trim();
  if (configured) {
    const origin = originFromValue(configured);
    if (origin) return origin;
  }

  // En produccion sin URL publica configurada, Vercel expone el dominio real
  // en estas variables. Preferirlas evita derivar el origen del header Host,
  // que en un despliegue self-hosted puede inyectar un dominio ajeno en los
  // links de recuperacion de contrasena.
  if (process.env.NODE_ENV === 'production') {
    const vercelHost = (
      process.env.VERCEL_PROJECT_PRODUCTION_URL ??
      process.env.VERCEL_URL ??
      ''
    ).trim();
    if (vercelHost) return originFromValue(`https://${vercelHost}`);
  }

  return null;
}

export function getAppOrigin(request: Request): string {
  const configured = configuredOrigin();
  if (configured) return configured;

  const requestOrigin = originFromValue(request.url);
  if (requestOrigin) return requestOrigin;

  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost ?? request.headers.get('host');
  const proto = (request.headers.get('x-forwarded-proto') ?? 'https').split(',')[0].trim();
  if (host && HOST_PATTERN.test(host) && /^[a-z]+$/i.test(proto)) {
    return `${proto.toLowerCase()}://${host}`;
  }

  return 'http://localhost:3000';
}

export function safeInternalRedirect(
  request: Request,
  target: string | null | undefined,
  fallback = '/dashboard'
): string {
  const origin = getAppOrigin(request);
  if (!target) return `${origin}${fallback}`;

  let candidate: string;
  try {
    candidate = new URL(target, origin).toString();
  } catch {
    return `${origin}${fallback}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return `${origin}${fallback}`;
  }

  if (parsed.origin !== origin) return `${origin}${fallback}`;
  if (!parsed.pathname.startsWith(INTERNAL_PREFIX) || parsed.pathname.startsWith('//')) {
    return `${origin}${fallback}`;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return `${origin}${fallback}`;
  }

  return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Normaliza un `next` a un path interno.
 *
 * Versión sin `Request` de `safeInternalRedirect`, para el cliente (por
 * ejemplo la página que canjea un magic link). Una URL absoluta, `//evil.com`
 * o `/\\evil.com` caen al fallback.
 */
export function safeInternalPath(
  target: string | null | undefined,
  fallback = '/dashboard'
): string {
  const raw = (target ?? '').trim();
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return fallback;
  }

  try {
    const base = 'http://internal.local';
    const parsed = new URL(raw, base);
    if (parsed.origin !== base) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
