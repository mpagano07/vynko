-- ============================================================
-- 046: create_sale_atomic no puede crear una venta incompleta en silencio
-- ============================================================
--
-- El problema
--
-- `create_sale_atomic` (045) valida los items asi:
--
--   IF jsonb_array_length(p_items) = 0 THEN
--     RAISE EXCEPTION 'No se pudo registrar la venta: la venta no tiene items';
--
-- Suena a que cubre todo, pero no. En SQL, `jsonb_array_length(NULL)` devuelve
-- NULL, no 0, y `NULL = 0` evalua NULL, que no es verdadero. O sea: el guard no
-- salta con `p_items` en NULL. Despues, `jsonb_array_elements(NULL)` devuelve
-- cero filas, asi que el INSERT de `sale_items` inserta CERO filas y NO da
-- error: no hay excepcion que capturar.
--
-- El resultado es la peor combinacion posible de los dos caminos:
--
--   - la venta existe en `sales`, con su total y su `created_by`
--   - NO existe en `sale_items`: nadie sabe que se vendio ni que precio se cobro
--   - el stock igual bajo, porque `decrement_stock` es un RPC aparte
--
-- y la API devuelve 201 como si nada. Una venta sin items no se puede facturar,
-- no se puede auditar por el reporte ni reconciliar contra la caja. El cajero
-- igual ve un OK.
--
-- Cuando puede pasar
--
-- Hoy el backend siempre manda `p_items` y `p_payments` como arrays, asi que no
-- se ha observado. Pero la funcion es `SECURITY DEFINER` y su unico contrato
-- es el nombre de los parametros: cualquier consumidor futuro (un trigger, un
-- script de importacion, un job de backfill) que llame la RPC con un argumento
-- de mas, de menos, o mal tipado reproduce esto sin necesitar ningun bug de JS.
-- La validacion tiene que estar en el lado que de verdad guarantees.
--
-- Que hace esta migracion
--
-- Agrega una comprobacion de TIPO antes de la de contenido, y separa las listas
-- obligatorias de las auxiliares.
--
--   - `p_items`, `p_payments`: deben ser arrays NO VACIOS. Una venta sin items
--     no es una venta; una venta sin pagos no se puede conciliar contra la caja.
--   - `p_stock_movements`: debe ser un array, pero puede estar vacio. Los
--     movimientos son la bitacora de por que bajo el stock; el descuento ya lo
--     aplico `decrement_stock`, asi que un array vacio es un estado tolerable
--     mientras que un NULL sigue siendo un bug del caller.
--
-- `COALESCE` en vez de `NULL`: normalizar el NULL a `'[]'` seria exactamente el
-- bug que se quiere evitar, porque el ARRAY VACIO de items tambien tiene que
-- fallar.
--
-- Los mensajes de los dos errores que ya existian se conservan: son los que el
-- front ya sabe mostrar. El de tipo nuevo tiene su propio mensaje para que un
-- error de contrato no se confunda con "el cajero no agrego productos".

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
  -- Tipo primero. `jsonb_typeof(NULL)` es NULL, asi que `IS DISTINCT FROM
  -- 'array'` da TRUE con NULL: esto si atrapa el caso que el guard de 045 dejaba
  -- pasar. `jsonb_typeof` tambien distingue un objeto o un string, que si
  -- fallarian con un error de cast confuso mas abajo.
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION
      'No se pudo registrar la venta: los items llegaron como %, se esperaba una lista',
      COALESCE(jsonb_typeof(p_items), 'null');
  END IF;

  IF jsonb_typeof(p_payments) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION
      'No se pudieron guardar los pagos de la venta: los pagos llegaron como %, se esperaba una lista',
      COALESCE(jsonb_typeof(p_payments), 'null');
  END IF;

  IF jsonb_typeof(p_stock_movements) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION
      'No se pudieron guardar los movimientos de stock de la venta: los movimientos llegaron como %, se esperaba una lista',
      COALESCE(jsonb_typeof(p_stock_movements), 'null');
  END IF;

  -- Contenido, ahora que el tipo ya esta verificado.
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No se pudo registrar la venta: la venta no tiene items';
  END IF;

  IF jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'No se pudieron guardar los pagos de la venta: la venta no tiene pagos';
  END IF;

  -- `total` (DECIMAL(10,2)) viene del legacy en pesos. Se mantiene filled para
  -- no romper las consultas que todavia lo leen, derivandolo de los centavos.
  v_total := ROUND(p_total_cents::NUMERIC / 100, 2);

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
  'Registra venta, pagos, items y movimientos de stock en una sola transaccion y un solo round trip. Rechaza p_items o p_payments que no sean arrays no vacios: una venta sin items ni pagos se persiste igual en `sales` y no se puede facturar ni conciliar.';

-- La firma no cambio, asi que el GRANT de 045 sigue vigente. Se repite para que
-- esta migracion sea autocontenida si alguien la corre sola.
REVOKE ALL ON FUNCTION public.create_sale_atomic(
  UUID, UUID, BIGINT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT, UUID, JSONB, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_sale_atomic(
  UUID, UUID, BIGINT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT, UUID, JSONB, JSONB, JSONB
) TO service_role;