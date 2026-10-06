-- 052_webhook_delivery_id.sql
--
-- Id de ENTREGA del webhook de MercadoPago en `webhook_events`.
--
-- La bitacora de 044 quedo con `provider_event_id`, que en suscripciones es el
-- id del PREAPPROVAL. Ese id se REUTILIZA en eventos legitimos distintos (cada
-- cobro mensual reenvia `authorized` con el mismo id, la cancelacion tambien),
-- asi que 044 nota, y con razon, que no puede ser clave de idempotencia.
--
-- MercadoPago ademas manda por header `x-request-id`: el id de la NOTIFICACION,
-- unico POR ENTREGA. Un reintento de la misma entrega (timeout de red, doble
-- delivery) repite ese id; una renovacion mensual es una notificacion nueva con
-- un id distinto, aunque apunte al mismo preapproval. Con ese dato, deduplicar
-- es correcto: se cortan SOLO los replays de una entrega ya registrada como
-- exitosa, y las renovaciones legitimas pasan sin chistar.
--
-- El dedupe temprano en el route lee esta tabla ANTES de llamar a la API de
-- MercadoPago y de tocar tenants; el indice unico parcial es el backstop para
-- la carrera de dos deliveries simultaneos (el insert perdedor falla el UNIQUE,
-- y `recordWebhookEvent` nunca lanza: evita el bisturi en la bitacora).

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS delivery_id TEXT;

-- Un delivery solo puede haberse procesado una vez, y la consulta de dedupe es
-- un look-up por (provider, delivery_id).
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_delivery_idx
  ON public.webhook_events (provider, delivery_id)
  WHERE delivery_id IS NOT NULL;

-- Sigue siendo de solo-service-role: el dedupe leeria filas que otro podria
-- plantar si RLS no estuviera cerrado (ya esta cerrado en 044; el ALTER no
-- toca RLS ni grants).