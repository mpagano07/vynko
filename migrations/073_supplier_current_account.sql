-- 073_supplier_current_account.sql
--
-- Cuenta corriente de proveedores (Opción A, MVP).
-- Decisiones:
-- 1A) La deuda nace al recibir mercadería: el documento adeudado es el
--     commercial_document `remito_ingreso` (completed) generado en la recepción.
-- 2A) Pagos imputados a documentos/recepciones específicos (parciales/repartidos).
-- 3A) Sin edición: corrección por anulación (status=voided) con motivo.
-- 4B) Corte configurable en tenants.settings.purchases.account_current_cutoff_date.
-- 5A/5C) Plazo/vencimiento por OC y condición de pago por defecto en proveedor.

-- Condición de pago por defecto del proveedor (días).
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS payment_term_days INTEGER;

-- Vencimiento a nivel orden de compra.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS payment_term_days INTEGER,
  ADD COLUMN IF NOT EXISTS payment_due_date DATE;

-- Pagos a proveedores (cabecera). No se edita: se anula (voided).
CREATE TABLE IF NOT EXISTS supplier_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  payment_date DATE NOT NULL,
  method TEXT NOT NULL DEFAULT 'other',
  reference TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'voided')),
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id),
  void_reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'voided' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);

-- Imputaciones de cada pago a recepciones/OCs (2A).
CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  document_id UUID REFERENCES commercial_documents(id) ON DELETE SET NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_supplier_payments_tenant_supplier_date
  ON supplier_payments(tenant_id, supplier_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_tenant_status
  ON supplier_payments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_allocations_tenant_po
  ON supplier_payment_allocations(tenant_id, purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_allocations_tenant_doc
  ON supplier_payment_allocations(tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_allocations_payment
  ON supplier_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier
  ON purchase_orders(tenant_id, supplier_id);

-- RLS
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payment_allocations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_payments'
    AND policyname = 'Users can view their tenant supplier payments'
  ) THEN
    CREATE POLICY "Users can view their tenant supplier payments" ON supplier_payments
      FOR SELECT USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_payments'
    AND policyname = 'Users can insert supplier payments in their tenant'
  ) THEN
    CREATE POLICY "Users can insert supplier payments in their tenant" ON supplier_payments
      FOR INSERT WITH CHECK (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_payments'
    AND policyname = 'Users can update supplier payments in their tenant'
  ) THEN
    CREATE POLICY "Users can update supplier payments in their tenant" ON supplier_payments
      FOR UPDATE USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_payment_allocations'
    AND policyname = 'Users can view their tenant supplier payment allocations'
  ) THEN
    CREATE POLICY "Users can view their tenant supplier payment allocations" ON supplier_payment_allocations
      FOR SELECT USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'supplier_payment_allocations'
    AND policyname = 'Users can insert supplier payment allocations in their tenant'
  ) THEN
    CREATE POLICY "Users can insert supplier payment allocations in their tenant" ON supplier_payment_allocations
      FOR INSERT WITH CHECK (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

COMMENT ON TABLE supplier_payments IS 'Pagos a proveedores (cuenta corriente). No se editan: se anulan con status=voided+motivo.';
COMMENT ON TABLE supplier_payment_allocations IS 'Imputaciones de pagos a remitos/recepciones (commercial_documents) y OC.';
COMMENT ON COLUMN suppliers.payment_term_days IS 'Condición de pago por defecto en días para nuevas OC.';
COMMENT ON COLUMN purchase_orders.payment_term_days IS 'Plazo de pago en días de la OC.';
COMMENT ON COLUMN purchase_orders.payment_due_date IS 'Fecha de vencimiento explícita de la OC (si aplica).';
