# Observabilidad — logs, dashboard de errores y alertas

Estado: implementado (logs estructurados + Sentry). Falta configurar las
alertas en Sentry y el uptime check (ver al final).

## Logs estructurados

Todo el código server (servicios en `src/lib`, rutas en `src/app/api`, el proxy
y los crons) loguea con `@/lib/logger`, no con `console.*`:

- **Formato**: UNA linea JSON por evento:
  `{"level":"error","time":"2026-10-08T12:00:00.000Z","msg":"DB error", ...}`
- **Niveles**: `debug | info | warn | error | silent`. Se filtran con
  `LOG_LEVEL` (`.env.example`); default `info`. `error`/`warn` van a stderr y
  `info`/`debug` a stdout.
- **Errores**: un `Error` se serializa con `name`, `message`, `stack` y sus
  propiedades propias (`code` de Postgres, `details`, `hint` de Supabase).
  `JSON.stringify` a pelo tiraba `message`/`stack` por no ser enumerables; por
  eso existe `toLogValue` en `src/lib/logger.ts`.
- **Contexto por request**: `src/lib/log-context.ts` guarda
  `requestId / userId / tenantId / tenantIds` en un `AsyncLocalStorage` que se
  entra al autenticar (`src/lib/api-auth.ts`) y lo hereda todo lo que se ejecute
  despues en ese request, incluidos los trabajos de `after()`. Los endpoints que
  no pasan por auth (cron, webhook de MP) entran el contexto a mano con
  `enterLogContext(...)`, taggeados con `job`.
- **Bindings**: `logger.child({ tenantId })` para logs de un modulo o job.
- **Cliente**: los componentes de browser usan `console.*` (no llegan a Vercel);
  los errores de UI igual caen en Sentry via `src/app/**/error.tsx`.

### Donde se miran

1. Vercel → proyecto → **Logs** (funciones): las lineas JSON se parsean y se
   pueden filtrar por `level`, `msg`, `tenantId`, `requestId`.
2. Para reconstruir un request: buscar el `requestId` (header `x-vercel-id`
   tambien sirve).
3. En local, `LOG_LEVEL=debug npm run dev` para el nivel completo.

Si necesitas un log nuevo, usa `logger.error('que fallo', { error, tenantId })`
y no `console.error`: el primero es busquable, el segundo es texto libre.

## Dashboard de errores (Sentry)

- Config: `src/sentry.client.ts`, `src/sentry.server.ts`, registrado desde
  `src/instrumentation.ts` (`register` + `onRequestError`).
- Sin `SENTRY_DSN` no pasa nada: dev y CI corren sin Sentry.
- **Scrubbing de PII** antes de enviar: `src/lib/sentry/scrub.ts` (con tests en
  `scrub.test.ts`). No desactives `beforeSend` sin leerlo: los eventos pasan por
  aca.
- Muestreo de transacciones: `SENTRY_TRACES_SAMPLE_RATE` (default 0.05).
- Environment: `SENTRY_ENVIRONMENT` (default `NODE_ENV`).

### Que configurar en el panel (una sola vez)

1. **Alertas de issue** → Project → Alerting → Issue Alert:
   - "nuevo issue" → notificacion a Slack/email (no solo "regression");
   - "issue con mas de 50 eventos en 10 min" (posible loop o fuga);
   - "issue sin resolver de nivel error en production" → page.
2. **Uptime check** sobre `GET /api/health?check=db` (devuelve 503 si la base no
   responde). Es el unico chequeo que detecta "la app levanta pero no lee DB".
3. **Ownership**: al crear un issue, asignarlo; un issue sin asignar despues de
   48 h es deuda.

### Triaje de un issue nuevo

1. ¿Afecta a datos o cobros? → S1 en el runbook (`docs/runbook.md`).
2. Buscar `requestId`/`tenantId` del evento en los logs de Vercel para ver el
   request completo.
3. Si es un error esperado y manejado (401, retry de MP), marcarlo como
   *ignored* en Sentry con un comentario del por qué: si no, la proxima vez se
   ignora igual pero sin contexto.
4. Si es nuevo y tiene fix, PR con el issue linkado (`SENTRY-XXX` en la
   descripcion): Sentry cierra el issue al desplegar.

## Otros sensores

| Senal | Donde | Que dice |
|---|---|---|
| Health liveness | `GET /api/health` | proceso vivo + version del commit |
| Health readiness | `GET /api/health?check=db` | si Supabase responde (503 = caida) |
| Errores de UI | `src/app/**/error.tsx` | render de error + captura a Sentry |
| Metricas de producto | `/admin/analytics` (`src/app/admin/analytics/page.tsx`) | funnel signup → primera venta |
| Bitacora de acciones | tabla `activity_logs` | que hizo cada usuario dentro del tenant |
