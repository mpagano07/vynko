-- DIAGNÓSTICO (seguro): "Ajustar precios" queda en 0 de N con N errores.
-- Ejecutar contra la base afectada (Supabase SQL editor). No muta nada:
-- los probes terminan en ROLLBACK.
--
-- Contexto: adjustPrices aplica los precios con un upsert
-- (INSERT ... ON CONFLICT (id) DO UPDATE). El INSERT arma la fila SOLO con
-- las columnas enviadas, así que toda columna NOT NULL sin default tiene que
-- ir en el body. En DEV el esquema sale de las migraciones y `sku` es
-- nullable; en PROD `sku` quedó NOT NULL sin default por drift (el import de
-- Excel ya lo documenta). Si el upsert la omite, cada tanda muere con 23502
-- antes de llegar al UPDATE.

-- ============ A) Columnas NOT NULL sin default de products ============
-- Son las que el upsert está obligado a mandar. Si aparece `sku`, ese es el
-- motivo del "0 de N".
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'products'
  AND is_nullable = 'NO'
  AND column_default IS NULL
ORDER BY ordinal_position;

-- ============ B) PROBE con ROLLBACK: upsert SIN sku (código viejo) ============
-- Reproduce el fallo. Si la base tiene `sku NOT NULL`, acá aparece el error
-- exacto de Postgres (23502 "null value in column sku").
BEGIN;
WITH target AS (
  SELECT id, name, price_cents, cost
  FROM public.products
  ORDER BY id
  LIMIT 1
)
INSERT INTO public.products (id, name, price_cents, cost, updated_at)
SELECT id, name, round(price_cents * 1.002)::bigint,
       CASE WHEN cost IS NULL THEN NULL ELSE round(cost * 1.002) END,
       now()
FROM target
ON CONFLICT (id) DO UPDATE
  SET price_cents = EXCLUDED.price_cents,
      cost = EXCLUDED.cost,
      updated_at = EXCLUDED.updated_at;
ROLLBACK;

-- ============ C) PROBE con ROLLBACK: upsert CON sku (código nuevo) ============
-- Debe pasar sin error. Es la prueba de que el fix destraba el ajuste.
BEGIN;
WITH target AS (
  SELECT id, name, sku, price_cents, cost
  FROM public.products
  ORDER BY id
  LIMIT 1
)
INSERT INTO public.products (id, name, sku, price_cents, cost, updated_at)
SELECT id, name, coalesce(sku, ''), round(price_cents * 1.002)::bigint,
       CASE WHEN cost IS NULL THEN NULL ELSE round(cost * 1.002) END,
       now()
FROM target
ON CONFLICT (id) DO UPDATE
  SET price_cents = EXCLUDED.price_cents,
      cost = EXCLUDED.cost,
      updated_at = EXCLUDED.updated_at;
ROLLBACK;
