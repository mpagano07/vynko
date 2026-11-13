-- 072_cancellation_reason.sql
--
-- Motivo de baja de la suscripción.
--
-- El modal de retención ya preguntaba "¿Qué te llevó a cancelar?" pero la
-- respuesta se descartaba: `billing/page.tsx` ignoraba el argumento de
-- `onContinue` y el POST a `/api/billing/portal` no mandaba body. Sin esto no
-- hay forma de saber por qué se van los clientes.
--
-- Se guarda en `tenants` (la suscripción es del owner, no de la rama) y no en
-- una tabla nueva: es un dato mutable y de baja cardinalidad, uno por tenant.
-- El historial completo queda igual en `analytics_events`
-- (`subscription_cancelled` con el motivo en `metadata`), así que una baja
-- seguida de una nueva suscripción y otra baja no pierde la baja anterior.
--
-- `cancellation_reason` no lleva CHECK a propósito: la lista cerrada vive en
-- `src/lib/billing/cancel-reasons.ts` y se valida con zod en la ruta. Un CHECK
-- obligaría a una migración cada vez que producto agrega un motivo.

alter table public.tenants
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz;

comment on column public.tenants.cancellation_reason is
  'Último motivo de baja elegido en el portal (id de src/lib/billing/cancel-reasons.ts). NULL si no eligió.';
comment on column public.tenants.cancelled_at is
  'Fecha de la última baja de suscripción desde el portal.';
