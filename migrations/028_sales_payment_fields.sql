-- ========================================
-- Migration: 028_sales_payment_fields.sql
-- Agrega a `sales` los campos del flujo de cobro: medio de pago, monto
-- abonado, vuelto, descuento y recargo (todo en centavos).
--
-- Los campos se agregan con IF NOT EXISTS para que la migration sea segura
-- en cualquier entorno (dev/prod) y se pueda re-ejecutar.
-- ========================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS amount_paid_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS change_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS discount_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS surcharge_cents BIGINT NOT NULL DEFAULT 0;