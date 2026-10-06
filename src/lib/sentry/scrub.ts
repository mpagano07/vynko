import type { ErrorEvent, Event, TransactionEvent } from '@sentry/core';

const REDACTED = '[Filtered]';

// Headers que pueden llevar credenciales / sesion y nunca deben salir del server.
const SENSITIVE_HEADERS = new Set([
  'cookie',
  'authorization',
  'x-supabase-auth',
  'x-supabase-refresh-token',
  'x-supabase-api-key',
  'sb-api-key',
  'api-key',
  'proxy-authorization',
]);

// Redacta cualquier clave cuyo nombre sugiera credenciales (via recursiva).
const SENSITIVE_KEY = /(^|_|-|\.)?(pass(word)?|secret|token|key|authorization|cookie|refresh)(es)?([-_\.]|$)/i;

export function getSentryDsn(): string | undefined {
  return process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;
}

export function isSentryEnabled(): boolean {
  return Boolean(getSentryDsn());
}

function redactDeep(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v, k);
    }
    return out;
  }
  return key && SENSITIVE_KEY.test(key) ? REDACTED : value;
}

function scrubRequest(request: Event['request']): void {
  if (!request) return;
  const headers = request.headers;
  if (headers && typeof headers === 'object') {
    for (const name of Object.keys(headers)) {
      if (SENSITIVE_HEADERS.has(name.toLowerCase())) {
        headers[name] = REDACTED;
      }
    }
  }
  const cookies = request.cookies;
  if (cookies && typeof cookies === 'object') {
    for (const name of Object.keys(cookies)) {
      cookies[name] = REDACTED;
    }
  }
}

function scrubUser(event: Event): void {
  const user = event.user;
  if (!user) return;
  if (typeof user.email === 'string') user.email = REDACTED;
  if (typeof user.username === 'string') user.username = REDACTED;
  if (typeof user.ip_address === 'string') user.ip_address = REDACTED;
}

export function scrubEvent(event: Event): Event {
  scrubRequest(event.request);
  if (event.extra) {
    event.extra = redactDeep(event.extra) as Event['extra'];
  }
  if (event.contexts) {
    event.contexts = redactDeep(event.contexts) as Event['contexts'];
  }
  scrubUser(event);
  return event;
}

export function scrubErrorEvent(event: ErrorEvent): ErrorEvent {
  return scrubEvent(event) as ErrorEvent;
}

export function scrubTransactionEvent(event: TransactionEvent): TransactionEvent {
  return scrubEvent(event) as TransactionEvent;
}