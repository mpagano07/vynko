-- ============================================================
-- 060: backfill de billing_provider + comentario de paddle_price_id
-- ============================================================
--
-- La 059 agregó `billing_provider` dejando NULL en toda cuenta preexistente,
-- asumiendo que NULL = "nunca inició un pago" (lo que documenta su COMMENT).
-- Pero las cuentas que YA estaban suscritas por MercadoPago también quedaron en
-- NULL: tienen `mercadopago_preapproval_id` pero nunca se les escribió el
-- proveedor (esa columna no existía).
--
-- Con `billing_provider` NULL, `createCheckoutSession` elige la pasarela por
-- país. Una cuenta de AR detectada fuera del país (viaje, VPN, proxy) podía
-- iniciar un checkout en Paddle ENCIMA de su preapproval de MP activo → doble
-- cobro. El guard en `createCheckoutSession` ya cubre ese camino leyendo el
-- preapproval; este backfill deja además el dato consistente para el resto de
-- los usos de `billing_provider` (cambio de plan, cancelación, display).
--
-- Idempotente: sólo toca filas NULL con preapproval.

UPDATE tenants
   SET billing_provider = 'mercadopago'
 WHERE billing_provider IS NULL
   AND mercadopago_preapproval_id IS NOT NULL;

-- ============================================================
-- Comentario de `paddle_price_id`: la 059 lo describía como "vigente", pero el
-- código lo escribe al INICIAR un checkout o cambio de plan (`createCheckoutSession`,
-- `downgradePlan`) con el `pri_` del checkout, y el webhook nunca lo actualiza ni
-- lo limpia. O sea: es el precio del último checkout iniciado, que puede quedar
-- pendiente de pago y no refleja necesariamente la suscripción vigente.
-- ============================================================

COMMENT ON COLUMN tenants.paddle_price_id IS
  'Precio de Paddle (pri_...) del último checkout iniciado. Depende del plan y la moneda del país. Se escribe al iniciar un checkout o cambio de plan; no se actualiza ni se limpia con el webhook.';
