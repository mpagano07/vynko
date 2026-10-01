-- ========================================
-- Índice en products(sku)
-- Migration: 041_add_products_sku_index.sql
-- ========================================
-- El import de Excel resuelve los SKU en bloque con `.in('sku', [...])` (lotes
-- de 200) para no hacer una query por fila. Sin índice, cada lote es un
-- sequential scan de `products`, que es global: 10 scans por un archivo de
-- 2000 filas. `barcode` ya tiene `idx_products_barcode` (016), pero `sku`
-- quedó sin índice.
--
-- No se agrega UNIQUE: `products` es global (016 dropeó tenant_id a
-- propósito), así que dos tenants pueden usar el mismo SKU legítimamente.
-- La deduplicación es responsabilidad de la app.
-- Idempotente.
-- ========================================

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
