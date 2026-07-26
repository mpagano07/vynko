-- ========================================
-- Add company_name to tenants
-- ========================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS company_name TEXT;
