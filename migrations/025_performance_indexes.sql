-- ========================================
-- Migration: 025_performance_indexes.sql
-- Optimización de rendimiento para consultas frecuentes de alta concurrencia
-- ========================================

-- 1. Índices para acelerar búsquedas y filtros de stock por tenant
CREATE INDEX IF NOT EXISTS idx_product_stock_tenant_active 
  ON product_stock (tenant_id, active);

CREATE INDEX IF NOT EXISTS idx_product_stock_tenant_product 
  ON product_stock (tenant_id, product_id);

-- 2. Índices para ventas y reportes periódicos
CREATE INDEX IF NOT EXISTS idx_sales_tenant_created 
  ON sales (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_customer_id 
  ON sales (customer_id);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id 
  ON sale_items (sale_id);

CREATE INDEX IF NOT EXISTS idx_sale_items_product_id 
  ON sale_items (product_id);

-- 3. Índices para historial de movimientos de stock
CREATE INDEX IF NOT EXISTS idx_stock_history_tenant_created 
  ON stock_history (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_history_product_tenant 
  ON stock_history (product_id, tenant_id);

-- 4. Índices para transferencias de stock entre sucursales
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from_tenant 
  ON stock_transfers (from_tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_to_tenant 
  ON stock_transfers (to_tenant_id, status);

-- 5. Índices para documentos comerciales
CREATE INDEX IF NOT EXISTS idx_commercial_documents_tenant_status 
  ON commercial_documents (tenant_id, status);
