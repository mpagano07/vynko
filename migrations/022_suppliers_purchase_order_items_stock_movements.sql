-- ========================================
-- Tablas que existian en PROD pero no estaban
-- versionadas en migrations (creadas ad-hoc).
-- Idempotente: sin efecto si ya existen (p. ej. en PROD).
-- ========================================

-- suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'suppliers'
    AND policyname = 'Tenant isolation'
  ) THEN
    CREATE POLICY "Tenant isolation" ON suppliers
      FOR ALL USING (
        tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid())
      ) WITH CHECK (
        tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid())
      );
  END IF;
END $$;

-- purchase_order_items
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0),
  quantity_received INTEGER DEFAULT 0,
  unit_cost_cents BIGINT NOT NULL
);

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'purchase_order_items'
    AND policyname = 'Tenant isolation'
  ) THEN
    CREATE POLICY "Tenant isolation" ON purchase_order_items
      FOR ALL USING (
        purchase_order_id IN (
          SELECT purchase_orders.id FROM purchase_orders
          WHERE purchase_orders.tenant_id IN (
            SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid()
          )
        )
      ) WITH CHECK (
        purchase_order_id IN (
          SELECT purchase_orders.id FROM purchase_orders
          WHERE purchase_orders.tenant_id IN (
            SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid()
          )
        )
      );
  END IF;
END $$;

-- stock_movements
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  movement_type TEXT NOT NULL
    CHECK (movement_type IN ('inbound', 'outbound', 'adjustment', 'sale', 'return')),
  reason TEXT,
  reference_id UUID,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_tenant ON stock_movements(tenant_id);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stock_movements'
    AND policyname = 'Tenant isolation'
  ) THEN
    CREATE POLICY "Tenant isolation" ON stock_movements
      FOR ALL USING (
        tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid())
      ) WITH CHECK (
        tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid())
      );
  END IF;
END $$;