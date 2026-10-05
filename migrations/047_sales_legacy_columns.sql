-- ============================================================
-- 047:(create_sale_atomic) deja de fallar en produccion
-- ============================================================
-- Error en prod al cobrar:
--
--   No se pudo registrar la venta: column "total" of relation "sales" does not exist
--
-- Que paso
-- --------
-- create_sale_atomic (045) inserta en `sales` dos columnas que existen en DEV
-- pero NO en PROD:
--
--   total       DECIMAL(10,2)   pesos, duplica a total_cents
--   created_by  UUID            duplica a sold_by
--
-- La 045 se escribio introspectando el proyecto de desarrollo, que arrastra
-- columnas legacy que produccion nunca tuvo. Comparando las dos bases:
--
--   solo en DEV: sales.total, sales.created_by, sales.updated_at,
--                sale_items.unit_price, sale_items.subtotal
--
-- Postgres reporta la PRIMERA columna que no encuentra, asi que el error es
-- `total`. Si solo se saca `total` de la lista, el error pasa a ser
-- `created_by`: hay que sacar las dos.
--
-- Ninguna de las dos se lee en ningun lado
-- ----------------------------------------
-- `sales.total` no aparece en ningun select del codigo: los unicos `total`
-- sueltos del lado de ventas salen de las vistas sales_daily_totals y
-- sales_monthly_totals, que ya exponen ese nombre y funcionan igual en prod.
-- `sales.created_by` tampoco se lee: el `created_by` que usa la app va en el
-- array p_stock_movements y termina en stock_history, que SI tiene la columna.
-- El INSERT de la venta duplica p_sold_by en created_by por compatibilidad con
-- ese legacy.
--
-- Por que este fix y no el otro
-- -----------------------------
-- Habia dos caminos: agregar las columnas en prod, o reescribir la funcion para
-- que deje de escribirlas. Se elige agregar las columnas porque es aditivo: no
-- puede romper ninguna consulta existente, y la funcion que ya esta desplegada
-- y en uso funciona sin tocar una sola linea de PL/pgSQL.
--
-- Reescribir la funcion es el cleanup correcto (las dos columnas son
-- redundantes: pesos contra centavos, y created_by contra sold_by), pero son
-- ~200 lineas que no se pueden probar antes de aplicarlas en produccion, y
-- produccion esta caida justo ahora. Cuando conviva, se puede hacer en una
-- migracion posterior y borrar estas columnas despues.

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS total NUMERIC(10,2);

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================
-- Verificacion: que no falte ninguna OTRA columna
-- ============================================================
-- La 045 fallo en produccion porque el DDL se escribio contra una base que no
-- era la de destino, y no habia nada que lo detectara hasta que alguien quiso
-- cobrar. Esta migracion no se trusts sola: chequea, antes de terminar, todas
-- las columnas que create_sale_atomic escribe. Si someday el esquema de prod
-- vuelve a diferir, el error sale al aplicar la migracion y dice exactamente
-- cuales faltan, en vez de aparecer como un 500 al cobrar.

DO $$
DECLARE
  required text[] := ARRAY[
    -- INSERT INTO sales
    'sales.tenant_id', 'sales.customer_id', 'sales.total', 'sales.total_cents',
    'sales.status', 'sales.notes', 'sales.created_by', 'sales.sold_by',
    'sales.payment_method', 'sales.amount_paid_cents', 'sales.change_cents',
    'sales.discount_cents', 'sales.surcharge_cents',
    -- INSERT INTO sale_payments
    'sale_payments.tenant_id', 'sale_payments.sale_id', 'sale_payments.method',
    'sale_payments.amount_cents', 'sale_payments.received_cents',
    'sale_payments.change_cents',
    -- INSERT INTO sale_items
    'sale_items.sale_id', 'sale_items.product_id', 'sale_items.quantity',
    'sale_items.unit_price_cents', 'sale_items.subtotal_cents',
    -- INSERT INTO stock_history
    'stock_history.tenant_id', 'stock_history.product_id', 'stock_history.quantity',
    'stock_history.type', 'stock_history.reason', 'stock_history.created_by',
    -- decrement_stock / increment_stock (043)
    'product_stock.stock', 'product_stock.updated_at'
  ];
  missing text[];
BEGIN
  SELECT array_agg(r.col ORDER BY r.col)
    INTO missing
    FROM unnest(required) AS r(col)
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name  = split_part(r.col, '.', 1)
        AND c.column_name = split_part(r.col, '.', 2)
   );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Faltan columnas que necesita create_sale_atomic: %', array_to_string(missing, ', ');
  END IF;

  RAISE NOTICE 'create_sale_atomic: las % columnas requeridas estan todas presentes', array_length(required, 1);
END $$;