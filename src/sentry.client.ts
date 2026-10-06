import * as Sentry from '@sentry/nextjs';
import {
  getSentryDsn,
  isSentryEnabled,
  scrubErrorEvent,
  scrubTransactionEvent,
} from '@/lib/sentry/scrub';

// Corre en el browser (via `instrumentation-client.ts`). Sin DSN no inicia
// nada: el bundle queda liviano y sin dependencia de configurar Sentry.
if (isSentryEnabled()) {
  Sentry.init({
    dsn: getSentryDsn(),
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
    tracesSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0.05
    ),
    beforeSend: scrubErrorEvent,
    beforeSendTransaction: scrubTransactionEvent,
  });
}