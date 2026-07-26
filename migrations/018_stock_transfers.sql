-- Stock Transfers between branches
-- Each transfer moves stock from one tenant (branch) to another

CREATE TABLE IF NOT EXISTS stock_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  to_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_transit', 'received')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  received_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INT NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view transfers involving their tenant"
  ON stock_transfers FOR SELECT
  USING (
    from_tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
    OR to_tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can view transfer items for their transfers"
  ON stock_transfer_items FOR SELECT
  USING (
    transfer_id IN (
      SELECT id FROM stock_transfers
      WHERE from_tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
        OR to_tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
    )
  );

CREATE INDEX IF NOT EXISTS idx_stock_transfers_from_tenant ON stock_transfers(from_tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to_tenant ON stock_transfers(to_tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer ON stock_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_product ON stock_transfer_items(product_id);

-- Add 'transfer' to stock_history type check constraint
ALTER TABLE stock_history DROP CONSTRAINT IF EXISTS stock_history_type_check;
ALTER TABLE stock_history ADD CONSTRAINT stock_history_type_check
  CHECK (type IN ('in', 'out', 'adjustment', 'transfer'));
