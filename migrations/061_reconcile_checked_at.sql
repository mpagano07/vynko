-- ============================================================
-- 061: cursor de rotación para las reconciliaciones de billing
-- ============================================================
--
-- Los reconciles de MercadoPago y Paddle toman `LIMIT 100` tenants ordenados
-- por `updated_at ASC`. El problema es que ninguna escritura de billing mueve
-- `updated_at` (ni el webhook, ni el propio reconcile): los mismos 100 tenants
-- quedaban siempre al frente y el resto nunca se revisaba.
--
-- `reconcile_checked_at` es un cursor que el reconcile escribe al terminar de
-- examinar cada tenant. Ordenando por `reconcile_checked_at ASC NULLS FIRST`,
-- las corridas rotan sin necesidad de una tabla de cursor: los que nunca se
-- revisaron (NULL) van primero y los ya revisados van al final.
--
-- Es best-effort: si el update falla, el tenant se reintenta en la próxima
-- pasada, que es exactamente lo que pasaría sin esta columna.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS reconcile_checked_at timestamptz;

COMMENT ON COLUMN tenants.reconcile_checked_at IS
  'Última vez que el reconcile de billing examinó este tenant. Cursor de rotación: se ordena ASC NULLS FIRST.';

CREATE INDEX IF NOT EXISTS idx_tenants_reconcile_checked_at
  ON tenants (reconcile_checked_at ASC NULLS FIRST)
  WHERE mercadopago_preapproval_id IS NOT NULL OR paddle_subscription_id IS NOT NULL;
