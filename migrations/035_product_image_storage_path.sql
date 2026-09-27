-- ========================================
-- Storage paths for product images
-- Migration: 035_product_image_storage_path.sql
-- ========================================
-- El bucket `product-images` pasa a privado (034), así que la URL pública
-- que se guardaba en products.image_url deja de resolver. Se guarda la
-- ruta del objeto y la app genera URLs firmadas de corta duración al leer.
-- `image_url` se conserva para imágenes externas (URLs de terceros).
-- Idempotente.
-- ========================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS image_storage_path TEXT;

-- Backfill: convierte URLs públicas existentes del bucket en su ruta.
UPDATE products
SET image_storage_path = split_part(image_url, '/object/public/product-images/', 2)
WHERE image_storage_path IS NULL
  AND image_url LIKE '%/object/public/product-images/%'
  AND split_part(image_url, '/object/public/product-images/', 2) <> '';

CREATE INDEX IF NOT EXISTS idx_products_image_storage_path
  ON products(image_storage_path)
  WHERE image_storage_path IS NOT NULL;
