import * as Sentry from '@sentry/nextjs';
import {
  getSentryDsn,
  isSentryEnabled,
  scrubErrorEvent,
  scrubTransactionEvent,
} from '@/lib/sentry/scrub';

let initialized = false;

// Idempotente y no-op sin DSN: la app funciona igual sin Sentry (dev, CI, o
// un deploy donde la variable no se cargo).
export function initSentryServer(): void {
  if (initialized) return;
  const dsn = getSentryDsn();
  if (!dsn) return;
  initialized = true;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
    // El trafico no se muestrea: solo el 5% de las transacciones se registran.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.05),
    beforeSend: scrubErrorEvent,
    beforeSendTransaction: scrubTransactionEvent,
  });
}

export function captureServerException(error: unknown): void {
  if (!isSentryEnabled()) return;
  initSentryServer();
  Sentry.captureException(error);
}