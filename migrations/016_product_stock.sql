-- ========================================
-- Product Stock: per-tenant stock tracking
-- ========================================

-- 0. Drop if it exists as a view or table from a previous attempt
DROP VIEW IF EXISTS product_stock CASCADE;
DROP TABLE IF EXISTS product_stock CASCADE;

-- 1. Create product_stock table
CREATE TABLE product_stock (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stock INT NOT NULL DEFAULT 0,
  min_stock INT NOT NULL DEFAULT 0,
  max_stock INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, tenant_id)
);

-- 2. Migrate existing stock data
INSERT INTO product_stock (product_id, tenant_id, stock, min_stock, max_stock)
SELECT id, tenant_id, stock, min_stock, max_stock FROM products
ON CONFLICT (product_id, tenant_id) DO NOTHING;

-- 3. Remove stock columns from products
ALTER TABLE products DROP COLUMN IF EXISTS stock;
ALTER TABLE products DROP COLUMN IF EXISTS min_stock;
ALTER TABLE products DROP COLUMN IF EXISTS max_stock;

-- 4. Remove tenant_id from products (products are now shared/global)
--    CASCADE drops dependent RLS policies automatically
ALTER TABLE products DROP COLUMN IF EXISTS tenant_id CASCADE;

-- 5. Drop the UNIQUE(barcode) constraint so we can have a more flexible index
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_barcode_key;
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

-- 6. Drop RLS policies on products that reference tenant_id
DROP POLICY IF EXISTS "Users can view their tenant products" ON products;
DROP POLICY IF EXISTS "Users can insert products in their tenant" ON products;
DROP POLICY IF EXISTS "Users can update products in their tenant" ON products;

-- 7. Create new RLS policies for products (global read, authenticated write)
CREATE POLICY "All authenticated users can view products" ON products
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert products" ON products
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update products" ON products
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete products" ON products
  FOR DELETE USING (auth.role() = 'authenticated');

-- 8. RLS policies for product_stock (scoped to tenant)
ALTER TABLE product_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their tenant product stock" ON product_stock;
CREATE POLICY "Users can view their tenant product stock" ON product_stock
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can insert product stock in their tenant" ON product_stock;
CREATE POLICY "Users can insert product stock in their tenant" ON product_stock
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update product stock in their tenant" ON product_stock;
CREATE POLICY "Users can update product stock in their tenant" ON product_stock
  FOR UPDATE USING (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

-- 9. Indexes
CREATE INDEX IF NOT EXISTS idx_product_stock_product_id ON product_stock(product_id);
CREATE INDEX IF NOT EXISTS idx_product_stock_tenant_id ON product_stock(tenant_id);
