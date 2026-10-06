-- ============================================================
-- 048: idempotencia de ventas + stock dentro de la transaccion
-- ============================================================
--
-- DOS COSAS, porque se refuerzan entre si.
--
-- 1) EL DESCUENTO DE STOCK ENTRA A `create_sale_atomic`
--
-- Desde 043 el descuento es `decrement_stock`, una RPC aparte que escribe y se
-- confirma ANTES de que `create_sale_atomic` inserte la venta. Ese orden deja
-- dos fallas que ninguna de las dos funciones puede evitar por si sola:
--
--   - si el proceso muere entre el UPDATE de stock y el INSERT de la venta, el
--     stock queda descontado sin venta, y el rollback que el backend hacia con
--     `increment_stock` nunca corre;
--   - si `create_sale_atomic` falla, el backend tiene que devolver el stock con
--     una RPC compensatoria que puede fallar en silencio.
--
-- El stock pasa a descontarse DENTRO de la transaccion de la venta, con la
-- misma sentencia atomica que ya usaba `decrement_stock` (`WHERE stock >= qty`
-- en el propio UPDATE, con el lock de fila). Cualquier fallo posterior revierte
-- el descuento con el rollback de Postgres, sin caminos compensatorios desde JS.
-- De paso se va la secuencia de N round trips por item: la venta completa queda
-- en UNA llamada.
--
-- Los mensajes de "Stock insuficiente" se conservan al pie de la letra: son los
-- que el front ya sabe mostrar y los que el load test mide.
--
-- 2) CLAVE DE IDEMPOTENCIA
--
-- POST /api/sales no era idempotente: un reintento del cliente (timeout, doble
-- clic) ejecutaba la venta dos veces, descontaba el doble y registraba dos
-- lineas. La clave viene en el header `Idempotency-Key`: el cliente la genera
-- una vez por intento de compra y la reusa en los reintentos del mismo intento.
--
-- El registro de idempotencia vive en una tabla aparte `sale_idempotency_keys`
-- y NO en columnas de `sales`, para que la clave y el hash del payload no se
-- filtren en las respuestas GET (que hacen `select('*')`).
--
-- La fila se inserta ADENTRO de la transaccion de la venta, apuntando a la
-- venta recien creada y con el hash del request que la origino:
--
--   - la fila existe  <=>  la venta se confirmo (misma transaccion);
--   - el backend ya pregunto por la clave antes de llamar a la RPC, y sin fila
--     hace el camino normal;
--   - si dos requests con la misma clave corren a la vez, el que pierde la
--     carrera choca contra la PK de `sale_idempotency_keys`, se aborta TODO su
--     trabajo (incluido el stock, que ya vive aca adentro) y el backend relee
--     la fila del ganador y devuelve esa venta;
--   - no hay estado "en progreso" ni fila huerfana: si la venta no se confirmo,
--     la fila tampoco existe, y un reintento vuelve a ejecutar el request;
--   - un reintento con la MISMA clave pero payload distinto (mismo key,
--     venta distinta) se rechaza con 409 comparando el hash.
--
-- La clave se limpia sola: si algun dia se borra la venta, el ON DELETE
-- CASCADE borra su fila de idempotencia.

-- ============================================================
-- PARTE 1: tabla de idempotencia
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sale_idempotency_keys (
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Clave que manda el cliente en `Idempotency-Key`. No hay prefijo de
  -- proveedor ni versionado: la genera el front como UUID por intento.
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 255),
  -- La venta que gano la clave. `NOT NULL` a proposito: la fila solo se escribe
  -- cuando la venta existe, esa es la invariante que hace idempotente al flujo.
  sale_id         UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  -- SHA-256 del cuerpo canonico del request. Permite distinguir un reintento
  -- legitimo (mismo payload) de una colision de clave (payload distinto).
  request_hash    TEXT NOT NULL CHECK (char_length(request_hash) = 64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

-- Reconciliar de venta a clave, para debug y para el dump de ventas.
CREATE INDEX IF NOT EXISTS sale_idempotency_keys_sale_idx
  ON public.sale_idempotency_keys (sale_id);

-- Solo la service role la escribe, desde la transaccion de venta. Sin politica
-- FOR ALL: RLS deny-all por defecto, que es lo que queremos.
ALTER TABLE public.sale_idempotency_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sale_idempotency_keys FROM PUBLIC;
REVOKE ALL ON TABLE public.sale_idempotency_keys FROM anon, authenticated;
GRANT ALL ON TABLE public.sale_idempotency_keys TO service_role;

-- ============================================================
-- PARTE 2: create_sale_atomic con stock atomico e idempotencia
-- ============================================================

DROP FUNCTION IF EXISTS public.create_sale_atomic(
  UUID, UUID, BIGINT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT,
  UUID, JSONB, JSONB, JSONB
);

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
  p_stock_movements     JSONB  DEFAULT '[]'::JSONB,
  -- Idempotencia (048). Solos, cuando el request no trae `Idempotency-Key` el
  -- flujo se comporta igual que antes.
  p_idempotency_key     TEXT   DEFAULT NULL,
  p_request_hash        TEXT   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id       UUID;
  v_total         NUMERIC;
  v_stock         INTEGER;
  v_product_name  TEXT;
  v_item          RECORD;
BEGIN
  -- Tipo primero (046). `jsonb_typeof(NULL)` es NULL, asi que con NULL estas
  -- tres comparaciones dan TRUE y atrapan tambien el NULL.
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

  -- El stock se descuenta PRIMERO y adentro de la transaccion (048). Si
  -- cualquiera de los pasos de abajo falla, el rollback devuelve el stock sin
  -- RPC compensatoria.
  --
  -- Se recorre ordenado por `product_id` a proposito: si dos ventas concurrentes
  -- toman los locks de las mismas filas, las toman en el MISMO orden y no hay
  -- deadlock. Sin el ORDER BY, dos carritos con los productos en orden inverso
  -- programarian los locks cruzados.
  FOR v_item IN
    SELECT (i.value ->> 'product_id')::UUID AS product_id,
           (i.value ->> 'quantity')::INT    AS quantity
      FROM jsonb_array_elements(p_items) AS i
     ORDER BY (i.value ->> 'product_id')
  LOOP
    IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION
        'No se pudo registrar la venta: la cantidad de % debe ser mayor a 0',
        v_item.product_id;
    END IF;

    -- `stock >= quantity` va DENTRO del UPDATE: el check y el descuento son una
    -- sola sentencia bajo el lock de fila. Es la misma semantica que tenia
    -- `decrement_stock` (043), ahora sin viaje aparte.
    UPDATE public.product_stock ps
       SET stock = ps.stock - v_item.quantity,
           updated_at = now()
     WHERE ps.product_id = v_item.product_id
       AND ps.tenant_id = p_tenant_id
       AND ps.stock >= v_item.quantity
    RETURNING ps.stock INTO v_stock;

    -- No desconto: o no hay fila de stock para ese tenant, o no alcanza. Se
    -- relee para distinguir los dos casos en el mensaje, como hacia 043.
    IF v_stock IS NULL THEN
      SELECT pr.name, ps.stock
        INTO v_product_name, v_stock
        FROM public.products pr
        LEFT JOIN public.product_stock ps
          ON ps.product_id = pr.id AND ps.tenant_id = p_tenant_id
       WHERE pr.id = v_item.product_id;

      IF v_product_name IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado: %', v_item.product_id;
      END IF;
      IF v_stock IS NULL THEN
        RAISE EXCEPTION 'Stock insuficiente para "%"', v_product_name;
      END IF;
      RAISE EXCEPTION 'Stock insuficiente para "%" (disponible: %)', v_product_name, v_stock;
    END IF;
  END LOOP;

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

  -- Los movimientos de stock: la bitacora de por que bajo el stock, con el
  -- motivo construido ACA porque depende del id de venta recien generado.
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

  -- La fila de idempotencia se escribe aca, al final de la transaccion, para
  -- que exista solo cuando la venta entera quedo escrita.
  --
  -- El conflicto de PK es la UNICA forma en que esta funcion falla con
  -- 23505: el `sale_id` que va en la fila recien se inserto en esta misma
  -- transaccion, asi que un fallo de FK es imposible, y el unico otro escritor
  -- de esta tabla es otra llamada a esta funcion con la misma clave.
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.sale_idempotency_keys (tenant_id, idempotency_key, sale_id, request_hash)
    VALUES (p_tenant_id, p_idempotency_key, v_sale_id, p_request_hash)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;

    IF NOT FOUND THEN
      -- Otra peticion con la misma clave gano la carrera: se aborta TODA esta
      -- transaccion (incluido el stock que se desconto arriba) y el backend
      -- relee la fila del ganador y devuelve ESA venta. El 23505 es la senal:
      -- el backend distingue este caso con `error.code` y no lo muestra como
      -- un error del usuario.
      RAISE EXCEPTION
        'clave de idempotencia ya registrada por una venta concurrente'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

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
  'Registra venta, pagos, items, movimientos de stock y descuento de stock en una sola transaccion y un solo round trip. Con p_idempotency_key registra la clave y la venta atomicamente: un reintento concurrente con la misma clave aborta con 23505 y el backend devuelve la venta del ganador. Rechaza p_items o p_payments que no sean arrays no vacios.';

-- El DROP de arriba tiro la firma vieja y sus grants, asi que estos son los
-- unicos que quedan.
REVOKE ALL ON FUNCTION public.create_sale_atomic(
  UUID, UUID, BIGINT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT,
  UUID, JSONB, JSONB, JSONB, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_sale_atomic(
  UUID, UUID, BIGINT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT,
  UUID, JSONB, JSONB, JSONB, TEXT, TEXT
) TO service_role;