# Metricas de producto

Que se mide, donde se ve, y como agregar un evento sin romper el embudo.

## Donde se ve

- **Panel**: `/admin/analytics` (solo admin; el endpoint `/api/admin/analytics`
  es fail-closed igual que el resto de `/api/admin/*`).
- **Tabla**: `analytics_events` (migraciones `026` y `040_product_analytics_funnel.sql`).
- El panel muestra dos cosas distintas:
  - **Embudo**: 6 pasos encadenados. Solo entran los que son *puertas*
    (`FUNNEL_STEPS` en `src/lib/analytics-service.ts`): para llegar al paso N
    hace falta haber pasado el N-1.
  - **Desglose**: el resto de los eventos, sueltos, con usuarios/total y
    primera/ultima aparicion. No se encadenan a proposito: no todo el que
    vende abre caja, y meterlos en el embudo lo haria descendente de forma
    falsa.

## Catalogo de eventos

| Evento | Cuando se emite | Donde |
|---|---|---|
| `signup` | El alta de la persona (no de la empresa) | `POST /api/auth/signup` |
| `company_created` | Se crea la empresa / onboarding | `src/lib/create-company.ts`, `src/lib/onboarding-service.ts` |
| `trial_started` | Arranca el trial de 45 dias | mismos dos |
| `payment` | Entra un pago confirmado por MP | `src/lib/mercadopago-webhook-service.ts` |
| `subscription_started` | La suscripcion pasa a activa | `src/lib/mercadopago-webhook-service.ts` |
| `subscription_cancelled` | Se cancela (desde la app o desde MP) | `src/lib/billing-service.ts`, `mercadopago-webhook-service.ts` |
| `product_created` | Alta de producto | `src/lib/product-service.ts` |
| `excel_import` | Importacion masiva desde Excel | `src/lib/product-service.ts` |
| `first_sale` | Primera venta del usuario (**unica**) | `src/lib/sales-service.ts` |
| `first_cash_open` | Primera apertura de caja (**unica**) | `src/lib/cash-register-service.ts` |
| `first_purchase` | Primera orden de compra (**unica**) | `src/lib/purchase-order-service.ts` |
| `document_created` | Se crea un documento comercial | `src/lib/document-service.ts` |
| `forecast_opened` | Se abre `/forecast` | navegador → `POST /api/analytics/track` |
| `whatsapp_ticket` | Clic en compartir por WhatsApp | navegador → mismo endpoint |
| `app_return` | Vuelve a la app (layout raiz, **1 por 24 h**) | `src/components/analytics/app-return-tracker.tsx` → mismo endpoint |

Los tres ultimos son los **unicos que nacen en el navegador**: el servidor no
los ve. El endpoint `/api/analytics/track` tiene su propia allowlist escrita en
codigo (`ALLOWED`): no acepta un `event_type` libre, porque cualquier usuario
autenticado podria fabricar eventos de su embudo con un `curl`.

Emision: `trackEvent` (servidor) o `trackClientEvent` (navegador). Los tres
`first_*` son **unicos por usuario** por el indice parcial de la migracion 040,
no por la app. `app_return` ademas corta en el servidor si el ultimo fue hace
menos de 24 h (`trackAppReturn`).

## Garantias que ya estan

- `trackEvent` **nunca tira**: si falta la migracion, si el CHECK rechaza el
  tipo o si Supabase esta caido, el evento se loguea y el negocio (venta,
  producto) se guarda igual. Es telemetria, no parte de la transaccion.
- Metadata del navegador sanitizada (10 claves, primitivas, strings a 200) y
  rate limit de 60 req/min por IP en `/api/analytics/track`.
- `userId` sale de la sesion, nunca del body.

## Como agregar un evento

1. Sumarlo al union `AnalyticsEventType` en `src/lib/track-event.ts`.
2. Agregarlo al `CHECK (event_type IN ...)` con una **migracion nueva**
   (`migrations/NNN_...`, `DROP CONSTRAINT` + `ADD CONSTRAINT`). Si se olvida,
   el insert falla con `23514` y el evento se pierde (se loguea, no se corta
   nada).
3. Emitirlo: `trackEvent(...)` desde el server, o, si nace en el navegador,
   sumarlo al union de `trackClientEvent` **y** a `ALLOWED` de
   `src/app/api/analytics/track/route.ts`.
4. Si es una puerta del embudo, agregarlo a `FUNNEL_STEPS` en
   `src/lib/analytics-service.ts` (y bancarse que el paso siguiente quede
   desconectado: el orden es semantico, no es una lista libre).
5. Cobertura: `src/lib/track-event.test.ts` (grabado y errores),
   `src/test/analytics-track.test.ts` (endpoint), `src/lib/analytics-service.test.ts`
   (embudo).

## Pendiente conocido

- El panel mezcla historico backfilleado con eventos en vivo (hay
  `StatusBadge` en `/admin/analytics` que lo marcan); al leer por meses, esa
  distincion importa.
- No hay export ni API publica: si hace falta consumirlo desde otro lado,
  primero exponerlo desde `/api/admin/analytics` con la misma autorizacion.
