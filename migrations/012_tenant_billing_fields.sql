-- ========================================
-- Add billing fields to tenants table
-- ========================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS razon_social TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_address TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_city TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_province TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_zip TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_phone TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_email TEXT;
