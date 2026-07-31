-- ========================================
-- Soft-delete flag for product_stock
-- Lets downgraded tenants keep products beyond the plan limit
-- (hidden instead of deleted, recoverable when back on Business)
-- ========================================

ALTER TABLE product_stock ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_product_stock_tenant_active ON product_stock(tenant_id, active);
