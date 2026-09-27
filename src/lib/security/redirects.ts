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

export function getAppOrigin(request: Request): string {
  const configured = (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    ''
  ).trim();
  if (configured) {
    const origin = originFromValue(configured);
    if (origin) return origin;
  }

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
