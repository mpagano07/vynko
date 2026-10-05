-- 044_webhook_events.sql
--
-- Bitacora de los webhooks de MercadoPago.
--
-- Por que NO se usa para idempotencia: la idea de poner aqui un
-- `UNIQUE (provider, data_id)` para deduplicar es incorrecta. `data.id` de un
-- webhook de suscripcion es el PREAPPROVAL id, y MercadoPago reutiliza el mismo
-- id en eventos legitimos distintos:
--
--   - cada cobro mensual reenvia `authorized` con el mismo preapproval id
--   - la cancelacion llega con el mismo id que los `authorized` anteriores
--
-- Un unique sobre esa clave descartaria renovaciones y cancelaciones reales,
-- que es peor que el doble proceso que se queria evitar. Por eso la
-- idempotencia NO depende de esta tabla: vive en el WHERE de los updates
-- (compare-and-set sobre `subscription_status`), que ademas resuelve dos
-- entregas simultaneas con el lock de fila de Postgres.
--
-- Lo que si aporta esta tabla es la trazabilidad que no habia: poder responder
-- "llego este evento, lo procesamos o lo descartamos, y por que" sin depender
-- de un `console.error` que se pierde al reiniciar el servidor.

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- `mercadopago` por ahora. La columna es provider y no un TEXT libre para
  -- que un segundo proveedor no tenga que rehacer la tabla.
  provider TEXT NOT NULL DEFAULT 'mercadopago',

  -- Id de la entidad en MercadoPago (el preapproval en suscripciones).
  -- NO es unico a proposito: ver la nota de arriba.
  provider_event_id TEXT NOT NULL,

  -- Topic tal cual lo mando MP (`type`), incluso si no lo procesamos.
  topic TEXT,

  -- Estado que(reporta MercadoPago, no el nuestro): authorized, cancelled,
  -- paused, pending.
  mp_status TEXT,

  -- Como termino el procesamiento desde nuestro lado.
  outcome TEXT NOT NULL DEFAULT 'received'
    CHECK (outcome IN (
      'received',   -- anotado, aun sin resultado
      'processed',  -- se aplico una transicion
      'duplicate',  --llego de nuevo y no habia transicion que aplicar
      'ignored',    -- topic o estado que no aplica
      'error'       -- fallo; el webhook se responde 5xx para que MP reintente
    )),

  -- Tenant y usuario deducidos del external_reference, cuando se pudieron
  -- resolver. Quedan NULL para los eventos que no son de suscripcion.
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Mensaje del error cuando outcome = 'error'. Sin esto un fallo se ve
  -- igual que un evento correcto.
  error TEXT,

  -- Cuanto tardo el handler completo. Permite ver si un evento se proceso
  -- normalmente o si llego cuando ya habia expirado.
  duration_ms INTEGER,

  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- La consulta que va a hacer la reconciliacion: "estos tenants tienen una
-- suscripcion y como quedó el ultimo evento que reciban".
CREATE INDEX IF NOT EXISTS webhook_events_tenant_received_idx
  ON public.webhook_events (tenant_id, received_at DESC);

-- Buscar un evento puntual por su id en MercadoPago, que es como se
-- investiga un cobro que no llego.
CREATE INDEX IF NOT EXISTS webhook_events_provider_event_idx
  ON public.webhook_events (provider, provider_event_id);

-- Los fallidos son la lista de trabajo: lo que hay que reintentar o mirar.
CREATE INDEX IF NOT EXISTS webhook_events_outcome_idx
  ON public.webhook_events (outcome)
  WHERE outcome = 'error';

-- Esta tabla se escribe desde el webhook con la service role, nunca desde el
-- cliente. Los defaults de Supabase abren el schema public a anon y
-- authenticated, asi que hay que revocar explicitamente: sin esto, cualquiera
-- podria insertar filas falsas en la bitacora.
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- Sin politica FOR ALL: por defecto RLS deny-all, que es lo que queremos. El
-- service role los ignora y es el unico que escribe.

REVOKE ALL ON TABLE public.webhook_events FROM PUBLIC;
REVOKE ALL ON TABLE public.webhook_events FROM anon, authenticated;
GRANT ALL ON TABLE public.webhook_events TO service_role;