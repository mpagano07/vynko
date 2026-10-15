-- ============================================================
-- 059: billing provider (MercadoPago | Paddle)
-- ============================================================
--
-- Hasta ahora la suscripción se cobraba sólo con MercadoPago (una cuenta AR,
-- siempre en ARS). Para LATAM se suma Paddle como Merchant of Record, que cobra
-- en la moneda local del comprador y se encarga del impuesto de cada país.
--
-- `billing_provider` es la fuente de verdad de POR CUÁL pasarela se cobra el
-- owner. Se setea al iniciar el checkout según el país y se usa después para
-- enrutar el cambio de plan y la cancelación (no se puede cancelar en Paddle
-- una suscripción de MercadoPago ni al revés). Queda NULL para las cuentas que
-- nunca iniciaron un pago (free/trial), así que NULL no significa "MercadoPago".
--
-- Las columnas `paddle_*` espejan las de MercadoPago: id de suscripción vigente,
-- precio, cliente, y el intento de cambio de plan pendiente de confirmación.
-- `paddle_price_id` guarda el precio concreto (cada moneda tiene su `pri_`), que
-- no se puede deducir del plan sin la config de env.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS billing_provider TEXT
    CHECK (billing_provider IN ('mercadopago', 'paddle'));

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paddle_price_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paddle_pending_transaction_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paddle_pending_plan TEXT
  CHECK (paddle_pending_plan IN ('starter', 'business'));

COMMENT ON COLUMN tenants.billing_provider IS
  'Pasarela con la que se cobra al owner: mercadopago | paddle. NULL si nunca inició un pago.';
COMMENT ON COLUMN tenants.paddle_subscription_id IS
  'ID de la suscripción vigente en Paddle (sub_...). NULL para cuentas que no cobran por Paddle.';
COMMENT ON COLUMN tenants.paddle_customer_id IS
  'ID del cliente en Paddle (ctm_...), para reusarlo en el próximo checkout.';
COMMENT ON COLUMN tenants.paddle_price_id IS
  'Precio de Paddle vigente (pri_...) — depende del plan y la moneda del país.';
COMMENT ON COLUMN tenants.paddle_pending_transaction_id IS
  'Transacción de Paddle (txn_...) creada para un checkout o cambio de plan pendiente de pago. Se limpia cuando el webhook confirma la suscripción.';
COMMENT ON COLUMN tenants.paddle_pending_plan IS
  'Plan destino del cambio pendiente de pago por Paddle.';

-- El webhook de Paddle resuelve el tenant por `paddle_subscription_id` cuando
-- el evento no trae (o ya no trae) el `custom_data`; sin este índice el lookup
-- es un scan completo de tenants.
CREATE INDEX IF NOT EXISTS tenants_paddle_subscription_idx
  ON tenants(paddle_subscription_id)
  WHERE paddle_subscription_id IS NOT NULL;

-- La RLS de `tenants` ya está forzada (053): agregar columnas no cambia el
-- acceso, que sigue siendo sólo por membresía + service role.
