-- ========================================
-- Product location (per tenant-product stock row)
-- Depósito → Pasillo → Estantería
-- ========================================

ALTER TABLE product_stock ADD COLUMN IF NOT EXISTS deposito TEXT;
ALTER TABLE product_stock ADD COLUMN IF NOT EXISTS pasillo TEXT;
ALTER TABLE product_stock ADD COLUMN IF NOT EXISTS estanteria TEXT;
