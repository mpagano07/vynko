-- ========================================
-- Stock checks: backstop a nivel DB
-- Valores negativos/inválidos de stock, min/max, precio y costo.
-- Se agregan con NOT VALID para no fallar por filas históricas que ya
-- existieran con datos incorrectos; el enforcement aplica desde ahora.
-- ========================================

-- products
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_non_negative;
ALTER TABLE products ADD CONSTRAINT products_price_non_negative
  CHECK (price >= 0) NOT VALID;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_cost_non_negative;
ALTER TABLE products ADD CONSTRAINT products_cost_non_negative
  CHECK (cost IS NULL OR cost >= 0) NOT VALID;

-- product_stock
ALTER TABLE product_stock DROP CONSTRAINT IF EXISTS product_stock_stock_non_negative;
ALTER TABLE product_stock ADD CONSTRAINT product_stock_stock_non_negative
  CHECK (stock >= 0) NOT VALID;

ALTER TABLE product_stock DROP CONSTRAINT IF EXISTS product_stock_min_stock_non_negative;
ALTER TABLE product_stock ADD CONSTRAINT product_stock_min_stock_non_negative
  CHECK (min_stock >= 0) NOT VALID;

ALTER TABLE product_stock DROP CONSTRAINT IF EXISTS product_stock_max_stock_non_negative;
ALTER TABLE product_stock ADD CONSTRAINT product_stock_max_stock_non_negative
  CHECK (max_stock >= 0) NOT VALID;