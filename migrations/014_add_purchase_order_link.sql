-- ========================================
-- Link commercial documents to purchase orders
-- ========================================

ALTER TABLE commercial_documents
  ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_commercial_documents_purchase_order_id
  ON commercial_documents(purchase_order_id);
