-- ============================================================
-- 045: venta atomica en un solo round trip + columnas faltantes
-- ============================================================
--
-- DOS COSAS EN ESTA MIGRACION, en este orden a proposito.
--
-- 1) COLUMNAS QUE FALTABAN
--
-- `sales.total_cents`, `sales.sold_by`, `sale_items.unit_price_cents` y
-- `sale_items.subtotal_cents` existen en la base de produccion pero NO estan
-- declaradas en ninguna migracion del repo. El codigo las escribe desde hace
-- tiempo, asi que la base de produccion esta bien; el problema es el otro: una2
-- base creada desde cero con `supabase db reset` NO las tiene y TODO el modulo
-- de ventas falla al insertar.
--
-- O sea: el historial de migraciones miente sobre el esquema. Cualquiera que
-- levante un entorno limpio, o que diff entre migraciones y una base real,
-- encuentra una diferencia que no esta en ningun lado. Se corrige declarando
-- las columnas de forma aditiva e idempotente: sobre la base de produccion no
-- cambia nada, sobre una base nueva las crea.
--
-- No se reorganiza ni se renombra nada mas: el objetivo es que el esquema
-- declarativo deje de mentir, no reescribir el historial.
--
-- 2) `create_sale_atomic`
--
-- Antes, registrar una venta eran 4 viajes de ida y vuelta a Postgres:
-- insert en `sales` + select para traer el id, insert en `sale_payments`, insert
-- en `sale_items`, y un insert por item en `stock_history`. Con N items son
-- 3 + N viajes, todos secuenciales, en el camino que el cajero esta mirando.
--
-- Ademas el rollback era a mano: si fallaba `sale_payments`, el codigo borraba
-- la venta con un `delete` compensatorio, y si fallaba `sale_items` hacia lo
-- mismo. Eso deja una ventana en la que la venta existe y despues no, y el
-- `delete` compensatorio puede fallar sin que nadie entienda por que quedo una
-- venta huerfana.
--
-- Una sola funcion lo resuelve: una transaccion, un viaje, y el rollback lo
-- hace Postgres. Los `raise` conservan el mensaje exacto que el front ya
-- muestra, para no cambiar el texto que ve el usuario.

-- ============================================================
-- PARTE 1: columnas que faltaban en las migraciones
-- ============================================================

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS total_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS sold_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS unit_price_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS subtotal_cents BIGINT NOT NULL DEFAULT 0;

-- Los indices que acompanan a esas columnas en el esquema real. `sales` se lee
-- por tenant y fecha en el listado y los KPIs, asi que sin esto el reporte de
-- ventas se pone a seq scan.
CREATE INDEX IF NOT EXISTS idx_sales_tenant_created
  ON sales (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sale_items_product
  ON sale_items (product_id);

-- ============================================================
-- PARTE 2: create_sale_atomic
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_sale_atomic(
  p_tenant_id           UUID,
  p_sold_by             UUID,
  p_total_cents         BIGINT,
  p_customer_id         UUID   DEFAULT NULL,
  p_status              TEXT   DEFAULT 'completed',
  p_notes               TEXT   DEFAULT NULL,
  p_payment_method      TEXT   DEFAULT 'cash',
  p_amount_paid_cents   BIGINT DEFAULT 0,
  p_change_cents        BIGINT DEFAULT 0,
  p_discount_cents      BIGINT DEFAULT 0,
  p_surcharge_cents     BIGINT DEFAULT 0,
  p_session_id          UUID   DEFAULT NULL,
  -- Listas de filas ya conformadas por el backend. Se pasan como jsonb y se
  -- desarman adentro para no perder el tipado de las tablas.
  p_payments            JSONB  DEFAULT '[]'::JSONB,
  p_items               JSONB  DEFAULT '[]'::JSONB,
  p_stock_movements     JSONB  DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id UUID;
  v_total   NUMERIC;
BEGIN
  -- `total` (DECIMAL(10,2)) viene del legacy en pesos. Se mantiene filled para
  -- no romper las consultas que todavia lo leen, derivandolo de los centavos.
  v_total := ROUND(p_total_cents::NUMERIC / 100, 2);

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No se pudo registrar la venta: la venta no tiene items';
  END IF;

  BEGIN
    INSERT INTO sales (
      tenant_id,
      customer_id,
      total,
      total_cents,
      status,
      notes,
      created_by,
      sold_by,
      payment_method,
      amount_paid_cents,
      change_cents,
      discount_cents,
      surcharge_cents,
      session_id
    )
    VALUES (
      p_tenant_id,
      p_customer_id,
      v_total,
      p_total_cents,
      p_status,
      p_notes,
      p_sold_by,
      p_sold_by,
      p_payment_method,
      p_amount_paid_cents,
      p_change_cents,
      p_discount_cents,
      p_surcharge_cents,
      p_session_id
    )
    RETURNING id INTO v_sale_id;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'No se pudo registrar la venta: %', SQLERRM;
  END;

  -- Los pagos. `received_cents` y `change_cents` tienen default en el backend.
  BEGIN
    INSERT INTO sale_payments (tenant_id, sale_id, method, amount_cents, received_cents, change_cents)
    SELECT
      p_tenant_id,
      v_sale_id,
      (payment ->> 'method')::TEXT,
      COALESCE((payment ->> 'amount_cents')::BIGINT, 0),
      COALESCE((payment ->> 'received_cents')::BIGINT, 0),
      COALESCE((payment ->> 'change_cents')::BIGINT, 0)
    FROM jsonb_array_elements(p_payments) AS payment;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'No se pudieron guardar los pagos de la venta: %', SQLERRM;
  END;

  BEGIN
    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price_cents, subtotal_cents)
    SELECT
      v_sale_id,
      (item ->> 'product_id')::UUID,
      (item ->> 'quantity')::INT,
      COALESCE((item ->> 'unit_price_cents')::BIGINT, 0),
      COALESCE((item ->> 'subtotal_cents')::BIGINT, 0)
    FROM jsonb_array_elements(p_items) AS item;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'No se pudieron guardar los items de la venta: %', SQLERRM;
  END;

  -- Los movimientos de stock. Antes era un insert por item desde JS: con 20
  -- items eran 20 viajes. Ademas un fallo a mitad dejaba la venta registrada con
  -- stock descontado pero sin historial, que es justo el estado que impide
  -- auditar por que bajo el stock.
  --
  -- El motivo se arma ACA y no desde el caller porque depende del id recien
  -- generado. El backend no lo conoce hasta que termina la llamada, asi que si
  -- lo pasara por parametro quedaria sin el sufijo de folio.
  BEGIN
    INSERT INTO stock_history (tenant_id, product_id, quantity, type, reason, created_by)
    SELECT
      p_tenant_id,
      (movement ->> 'product_id')::UUID,
      (movement ->> 'quantity')::INT,
      (movement ->> 'type')::TEXT,
      COALESCE(
        NULLIF(movement ->> 'reason', ''),
        'Venta #' || SUBSTR(v_sale_id::TEXT, 1, 8)
      ),
      COALESCE((movement ->> 'created_by')::UUID, p_sold_by)
    FROM jsonb_array_elements(p_stock_movements) AS movement;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'No se pudieron guardar los movimientos de stock de la venta: %', SQLERRM;
  END;

  -- Se devuelve la fila tal cual la construye Postgres, no la que pidio el
  -- caller: el `total` derivado y el `id` son los que valen.
  RETURN (
    SELECT to_jsonb(s)
    FROM sales s
    WHERE s.id = v_sale_id
  );
END;
$$;

COMMENT ON FUNCTION public.create_sale_atomic IS
  'Registra venta, pagos, items y movimientos de stock en una sola transaccion y un solo round trip. Los raise preservan los mensajes que el front ya muestra.';

-- Solo `service_role` la llama: es una escritura con bypass de RLS, asi que no
-- se le da acceso al rol autenticado ni al anonimo.
REVOKE ALL ON FUNCTION public.create_sale_atomic(
  UUID, UUID, BIGINT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT, UUID, JSONB, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_sale_atomic(
  UUID, UUID, BIGINT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT, UUID, JSONB, JSONB, JSONB
) TO service_role;