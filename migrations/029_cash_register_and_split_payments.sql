-- ========================================
-- Migration: 029_cash_register_and_split_payments.sql
--
-- 1. Pago dividido: tabla `sale_payments` con las sucesiones de medios de
--    pago de una venta (efectivo + transferencia, etc.).
-- 2. Arqueo / cierre de turno: sesiones de caja (`cash_register_sessions`)
--    y movimientos manuales de ingreso/egreso (`cash_movements`).
-- 3. `sales.session_id` vincula cada venta a la sesión de caja abierta.
-- ========================================

CREATE TABLE IF NOT EXISTS sale_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  received_cents BIGINT NOT NULL DEFAULT 0,
  change_cents BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_register_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opened_by UUID NOT NULL REFERENCES auth.users(id),
  opened_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  initial_fund_cents BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  closed_by UUID REFERENCES auth.users(id),
  closed_at TIMESTAMP WITH TIME ZONE,
  total_expected_cents BIGINT NOT NULL DEFAULT 0,
  total_counted_cents BIGINT NOT NULL DEFAULT 0,
  total_difference_cents BIGINT NOT NULL DEFAULT 0,
  expected_by_method JSONB DEFAULT '{}'::JSONB,
  counted_by_method JSONB DEFAULT '{}'::JSONB,
  difference_by_method JSONB DEFAULT '{}'::JSONB,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES cash_register_sessions(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('in', 'out')),
  reason TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES cash_register_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sale_payments_sale_id ON sale_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant ON cash_register_sessions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(session_id);
CREATE INDEX IF NOT EXISTS idx_sales_session_id ON sales(session_id);

-- RLS: las tablas nuevas son gestionadas por el service role (BYPASSRLS),
-- pero habilitamos RLS y políticas de lectura por tenant para consistencia.
ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_register_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sale_payments'
      AND policyname = 'Users can view their tenant sale payments'
  ) THEN
    CREATE POLICY "Users can view their tenant sale payments" ON sale_payments
      FOR SELECT USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cash_register_sessions'
      AND policyname = 'Users can view their tenant cash register sessions'
  ) THEN
    CREATE POLICY "Users can view their tenant cash register sessions" ON cash_register_sessions
      FOR SELECT USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cash_movements'
      AND policyname = 'Users can view their tenant cash movements'
  ) THEN
    CREATE POLICY "Users can view their tenant cash movements" ON cash_movements
      FOR SELECT USING (
        session_id IN (SELECT id FROM cash_register_sessions WHERE tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()))
      );
  END IF;
END $$;