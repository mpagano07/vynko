-- ========================================
-- Update purchase order statuses
-- Adds 'sent' and 'partial' to support
-- the full workflow:
-- draft → sent → partial → received
--                        → cancelled
-- ========================================

-- Drop the old check constraint
ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

-- Add the updated constraint
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('draft', 'sent', 'partial', 'received', 'cancelled'));

-- Migrate existing 'pending' records to 'sent'
UPDATE purchase_orders
  SET status = 'sent'
  WHERE status = 'pending';
