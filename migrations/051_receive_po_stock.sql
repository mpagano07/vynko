-- 051_receive_po_stock.sql
--
-- Mueve la recepcion de una orden de compra a `receive_po_stock`: incremento de
-- `quantity_received` CON TOPE, acreditacion de stock y status de la orden en
-- UNA sola transaccion.
--
-- Por que hace falta: `receivePurchaseOrder` hacia la recepcion desde JS como
-- una secuencia de viajes separados:
--
--   1) SELECT po (+ status) -> SELECT po_items -> cap "<= pendiente" en JS
--   2) por item: UPDATE po_items.quantity_received = <leido> + inc
--      UPDATE product_stock SET stock = <leido> + inc   (read-modify-write)
--   3) UPDATE purchase_orders SET status = 'received'/'partial'
--
-- Dos recepciones SIMULTANEAS de la misma orden leen el mismo
-- `quantity_received` (0) y el mismo stock; cada una hace su write ciego con
-- `stock = <leido> + inc`, y el stock del deposito sube el DOBLE para UNA
-- entrega ("stock inflation", documentado en architecture-plan 1.5.7). El cap
-- "<= lo pedido" tampoco protege: ambas leyeron que faltaba todo por recibir.
--
-- Aca todo corre bajo el lock de fila de la orden (`FOR UPDATE`, como en 050
-- para las transferencias): la primera recepcion incrementa quantity_received,
-- la segunda ESPERA, ve el valor ya incrementado y su topo se aplica sobre los
-- valores REALES. El incremento de stock es un upsert con suma at omica
-- (`stock = stock + inc`), sin lectura previa: imposible que se acredite de
-- mas. Cualquier RAISE (recibir mas de lo pedido) revierte el lote entero.
--
-- El remito (commercial_documents) lo sigue armando el backend aparte, como
-- arriba: lo que esta funcion protege es que el STOCK y los CONTADORES de la
-- orden no se muevan dos veces. Los mensajes se conservan al pie de la letra.

CREATE OR REPLACE FUNCTION receive_po_stock(
  p_order_id     UUID,
  p_tenant_id    UUID,
  p_by           UUID,
  p_items        JSONB,
  p_received_date DATE,
  p_deposito     TEXT,
  p_pasillo      TEXT,
  p_estanteria   TEXT
)
RETURNS TABLE (ok BOOLEAN, code TEXT, row JSONB)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order      RECORD;
  v_item       RECORD;
  v_inc        INTEGER;
  v_new_received INTEGER;
  v_all        BOOLEAN := TRUE;
  v_status     TEXT;
  v_received_at DATE;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Ocurrio un error inesperado. Intenta de nuevo.';
  END IF;

  -- Lock de fila desde el arranque: dos recepciones simultaneas de la misma
  -- orden se serializan aca; la perdedora ve los contadores ya incrementados.
  SELECT * INTO v_order
    FROM public.purchase_orders
   WHERE id = p_order_id
     AND tenant_id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', NULL::JSONB;
    RETURN;
  END IF;

  IF v_order.status = 'received' THEN
    RETURN QUERY SELECT false, 'already_received', NULL::JSONB;
    RETURN;
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN QUERY SELECT false, 'cancelled', NULL::JSONB;
    RETURN;
  END IF;

  -- Items ordenados por product_id (mismo criterio anti-deadlock que 048/050).
  -- El LEFT JOIN a products conserva un item cuyo producto ya no exista, con
  -- el nombre generico como hacia el backend.
  FOR v_item IN
    SELECT it.id, it.product_id, it.quantity_ordered, it.quantity_received,
           COALESCE(pr.name, 'Producto') AS product_name,
           COALESCE(inc.qty, 0) AS inc
      FROM public.purchase_order_items it
      LEFT JOIN public.products pr ON pr.id = it.product_id
      LEFT JOIN LATERAL (
        SELECT (e.value ->> 'quantity_received')::INTEGER AS qty
          FROM jsonb_array_elements(p_items) AS e
         WHERE (e.value ->> 'product_id')::UUID = it.product_id
      ) inc ON TRUE
     WHERE it.purchase_order_id = p_order_id
     ORDER BY it.product_id
  LOOP
    IF v_item.inc IS NULL OR v_item.inc <= 0 THEN
      IF v_item.quantity_received < v_item.quantity_ordered THEN
        v_all := FALSE;
      END IF;
      CONTINUE;
    END IF;

    v_new_received := v_item.quantity_received + v_item.inc;

    -- Topo: nunca recibir mas de lo pedido. Los incrementos de otra recepcion
    -- concurrente ya estan en quantity_received (la orden esta lockeada), asi
    -- que este chequeo ve los valores REALES, no una foto vieja.
    IF v_new_received > v_item.quantity_ordered THEN
      RAISE EXCEPTION
        'No se puede recibir más de lo pedido para "%" (pedido: %, recibido: %, llegan: %)',
        v_item.product_name, v_item.quantity_ordered, v_item.quantity_received, v_item.inc;
    END IF;

    UPDATE public.purchase_order_items
       SET quantity_received = v_new_received
     WHERE id = v_item.id;

    -- Acreditacion con suma atomica: sin lectura previa de stock, no hay
    -- read-modify-write que pueda pisar una entrega concurrente.
    INSERT INTO public.product_stock (product_id, tenant_id, stock, min_stock, max_stock)
    VALUES (v_item.product_id, p_tenant_id, v_item.inc, 0, 0)
    ON CONFLICT (product_id, tenant_id)
    DO UPDATE
       SET stock = public.product_stock.stock + EXCLUDED.stock,
           updated_at = now();

    IF p_deposito IS NOT NULL THEN
      UPDATE public.product_stock
         SET deposito = p_deposito
       WHERE product_id = v_item.product_id AND tenant_id = p_tenant_id;
    END IF;
    IF p_pasillo IS NOT NULL THEN
      UPDATE public.product_stock
         SET pasillo = p_pasillo
       WHERE product_id = v_item.product_id AND tenant_id = p_tenant_id;
    END IF;
    IF p_estanteria IS NOT NULL THEN
      UPDATE public.product_stock
         SET estanteria = p_estanteria
       WHERE product_id = v_item.product_id AND tenant_id = p_tenant_id;
    END IF;

    INSERT INTO public.stock_history (tenant_id, product_id, quantity, type, reason, created_by)
    VALUES (
      p_tenant_id,
      v_item.product_id,
      v_item.inc,
      'in',
      'Recepción PO #' || SUBSTR(p_order_id::TEXT, 1, 8),
      p_by
    );

    IF v_new_received < v_item.quantity_ordered THEN
      v_all := FALSE;
    END IF;
  END LOOP;

  v_status := CASE WHEN v_all THEN 'received' ELSE 'partial' END;
  v_received_at := CASE WHEN v_all THEN COALESCE(p_received_date, now()::date) END;

  -- La transicion con guarda: cualquier RAISE de arriba ya revirtio los
  -- incrementos de stock y de cantidad.
  UPDATE public.purchase_orders
     SET status = v_status,
         received_date = v_received_at,
         updated_at = now()
   WHERE id = v_order.id
  RETURNING jsonb_build_object('status', status, 'received_date', received_date, 'all', v_all)
    INTO row;

  RETURN QUERY SELECT true, NULL::TEXT, row;
END;
$$;

REVOKE ALL ON FUNCTION receive_po_stock(UUID, UUID, UUID, JSONB, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION receive_po_stock(UUID, UUID, UUID, JSONB, DATE, TEXT, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION receive_po_stock(UUID, UUID, UUID, JSONB, DATE, TEXT, TEXT, TEXT) TO service_role;