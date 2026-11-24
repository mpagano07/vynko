-- ============================================================
-- 075: variantes en las RPCs comerciales existentes
-- ============================================================
--
-- Todas las firmas se conservan. Las variantes viajan DENTRO de p_items /
-- p_stock_movements como un campo `variant_id` opcional, asi que el codigo que
-- todavia no las conoce sigue funcionando exactamente igual.
--
-- Un producto con variantes activas NO se puede vender/transferir/recibir por
-- product_id: la RPC lo rechaza. El historico no se reescribe.
-- ============================================================

-- ------------------------------------------------------------
-- 1. create_sale_atomic (firma identica a 048)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_sale_atomic(
  UUID, UUID, BIGINT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT,
  UUID, JSONB, JSONB, JSONB, TEXT, TEXT
);

CREATE FUNCTION public.create_sale_atomic(
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
  p_payments            JSONB  DEFAULT '[]'::JSONB,
  p_items               JSONB  DEFAULT '[]'::JSONB,
  p_stock_movements     JSONB  DEFAULT '[]'::JSONB,
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
  v_variant_id    UUID;
  v_variant_product UUID;
  v_variant_label TEXT;
BEGIN
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
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No se pudo registrar la venta: la venta no tiene items';
  END IF;
  IF jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'No se pudieron guardar los pagos de la venta: la venta no tiene pagos';
  END IF;

  v_total := ROUND(p_total_cents::NUMERIC / 100, 2);

  -- Orden determinista por producto Y variante: dos carritos con los mismos
  -- articulos toman los locks en el mismo orden aunque el front los ordene
  -- distinto. Es la misma garantia anti-deadlock de 048, extendida.
  FOR v_item IN
    SELECT (i.value ->> 'product_id')::UUID AS product_id,
           NULLIF(i.value ->> 'variant_id', '')::UUID AS variant_id,
           (i.value ->> 'quantity')::INT AS quantity
      FROM jsonb_array_elements(p_items) AS i
     ORDER BY (i.value ->> 'product_id'),
              COALESCE(i.value ->> 'variant_id', '')
  LOOP
    IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION
        'No se pudo registrar la venta: la cantidad de % debe ser mayor a 0',
        v_item.product_id;
    END IF;

    v_variant_id := v_item.variant_id;

    IF v_variant_id IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.product_variants v
          JOIN public.variant_stock s ON s.variant_id = v.id
         WHERE v.product_id = v_item.product_id
           AND s.tenant_id = p_tenant_id
           AND s.active
      ) THEN
        SELECT pr.name INTO v_product_name FROM public.products pr WHERE pr.id = v_item.product_id;
        RAISE EXCEPTION 'El producto "%" tiene variantes: elegí una variante para vender', COALESCE(v_product_name, '');
      END IF;

      UPDATE public.product_stock ps
         SET stock = ps.stock - v_item.quantity, updated_at = now()
       WHERE ps.product_id = v_item.product_id
         AND ps.tenant_id = p_tenant_id
         AND ps.stock >= v_item.quantity
      RETURNING ps.stock INTO v_stock;

      IF v_stock IS NULL THEN
        SELECT pr.name, ps.stock INTO v_product_name, v_stock
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
    ELSE
      SELECT v.product_id, v.label INTO v_variant_product, v_variant_label
        FROM public.product_variants v
       WHERE v.id = v_variant_id;

      IF v_variant_product IS DISTINCT FROM v_item.product_id THEN
        RAISE EXCEPTION 'La variante no pertenece al producto de la venta';
      END IF;

      UPDATE public.variant_stock s
         SET stock = s.stock - v_item.quantity, updated_at = now()
       WHERE s.variant_id = v_variant_id
         AND s.tenant_id = p_tenant_id
         AND s.active
         AND s.stock >= v_item.quantity
      RETURNING s.stock INTO v_stock;

      IF v_stock IS NULL THEN
        RAISE EXCEPTION 'Stock insuficiente para la variante "%" (disponible: %)',
          COALESCE(v_variant_label, v_variant_id::TEXT),
          (SELECT s.stock FROM public.variant_stock s
            WHERE s.variant_id = v_variant_id AND s.tenant_id = p_tenant_id);
      END IF;
    END IF;
    v_stock := NULL;
  END LOOP;

  BEGIN
    INSERT INTO sales (
      tenant_id, customer_id, total, total_cents, status, notes,
      created_by, sold_by, payment_method, amount_paid_cents, change_cents,
      discount_cents, surcharge_cents, session_id
    ) VALUES (
      p_tenant_id, p_customer_id, v_total, p_total_cents, p_status, p_notes,
      p_sold_by, p_sold_by, p_payment_method, p_amount_paid_cents, p_change_cents,
      p_discount_cents, p_surcharge_cents, p_session_id
    ) RETURNING id INTO v_sale_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'No se pudo registrar la venta: %', SQLERRM;
  END;

  BEGIN
    INSERT INTO sale_payments (tenant_id, sale_id, method, amount_cents, received_cents, change_cents)
    SELECT p_tenant_id, v_sale_id, (payment ->> 'method')::TEXT,
           COALESCE((payment ->> 'amount_cents')::BIGINT, 0),
           COALESCE((payment ->> 'received_cents')::BIGINT, 0),
           COALESCE((payment ->> 'change_cents')::BIGINT, 0)
      FROM jsonb_array_elements(p_payments) AS payment;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'No se pudieron guardar los pagos de la venta: %', SQLERRM;
  END;

  BEGIN
    INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, unit_price_cents, subtotal_cents)
    SELECT v_sale_id,
           (item ->> 'product_id')::UUID,
           NULLIF(item ->> 'variant_id', '')::UUID,
           (item ->> 'quantity')::INT,
           COALESCE((item ->> 'unit_price_cents')::BIGINT, 0),
           COALESCE((item ->> 'subtotal_cents')::BIGINT, 0)
      FROM jsonb_array_elements(p_items) AS item;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'No se pudieron guardar los items de la venta: %', SQLERRM;
  END;

  BEGIN
    INSERT INTO stock_history (tenant_id, product_id, variant_id, quantity, type, reason, created_by)
    SELECT p_tenant_id,
           (movement ->> 'product_id')::UUID,
           NULLIF(movement ->> 'variant_id', '')::UUID,
           (movement ->> 'quantity')::INT,
           (movement ->> 'type')::TEXT,
           COALESCE(NULLIF(movement ->> 'reason', ''), 'Venta #' || SUBSTR(v_sale_id::TEXT, 1, 8)),
           COALESCE((movement ->> 'created_by')::UUID, p_sold_by)
      FROM jsonb_array_elements(p_stock_movements) AS movement;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'No se pudieron guardar los movimientos de stock de la venta: %', SQLERRM;
  END;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.sale_idempotency_keys (tenant_id, idempotency_key, sale_id, request_hash)
    VALUES (p_tenant_id, p_idempotency_key, v_sale_id, p_request_hash)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'clave de idempotencia ya registrada por una venta concurrente'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN (SELECT to_jsonb(s) FROM sales s WHERE s.id = v_sale_id);
END;
$$;

COMMENT ON FUNCTION public.create_sale_atomic(
  UUID, UUID, BIGINT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT,
  UUID, JSONB, JSONB, JSONB, TEXT, TEXT
) IS 'Venta atomica con idempotencia. p_items/p_stock_movements aceptan variant_id opcional: con variante se descuenta variant_stock; sin variante se descuenta product_stock y se rechaza si el producto tiene variantes activas.';

REVOKE ALL ON FUNCTION public.create_sale_atomic(
  UUID, UUID, BIGINT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT,
  UUID, JSONB, JSONB, JSONB, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_sale_atomic(
  UUID, UUID, BIGINT, UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT,
  UUID, JSONB, JSONB, JSONB, TEXT, TEXT
) TO service_role;

-- ------------------------------------------------------------
-- 2. send_transfer / receive_transfer (firmas identicas a 050/071)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION send_transfer(
  p_transfer_id UUID,
  p_by          UUID
)
RETURNS TABLE (ok BOOLEAN, code TEXT, current_status TEXT, "row" JSONB)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_transfer RECORD;
  v_item     RECORD;
  v_after    INTEGER;
  v_name     TEXT;
  v_stock    INTEGER;
  v_row      JSONB;
BEGIN
  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', NULL::TEXT, NULL::JSONB; RETURN;
  END IF;
  IF v_transfer.status <> 'pending' THEN
    RETURN QUERY SELECT false, 'wrong_status', v_transfer.status, NULL::JSONB; RETURN;
  END IF;

  FOR v_item IN
    SELECT it.product_id, it.variant_id, it.quantity
      FROM public.stock_transfer_items it
     WHERE it.transfer_id = p_transfer_id
     ORDER BY it.product_id, COALESCE(it.variant_id, '00000000-0000-0000-0000-000000000000'::UUID)
  LOOP
    IF v_item.variant_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.product_variants v
                   JOIN public.variant_stock s ON s.variant_id = v.id
                  WHERE v.product_id = v_item.product_id
                    AND s.tenant_id = v_transfer.from_tenant_id
                    AND s.active) THEN
        RAISE EXCEPTION 'El producto tiene variantes: transferí una variante';
      END IF;
      UPDATE public.product_stock ps
         SET stock = ps.stock - v_item.quantity, updated_at = now()
       WHERE ps.product_id = v_item.product_id
         AND ps.tenant_id = v_transfer.from_tenant_id
         AND ps.stock >= v_item.quantity
      RETURNING ps.stock INTO v_after;
      IF v_after IS NULL THEN
        SELECT pr.name, ps.stock INTO v_name, v_stock
          FROM public.products pr
          LEFT JOIN public.product_stock ps
            ON ps.product_id = pr.id AND ps.tenant_id = v_transfer.from_tenant_id
         WHERE pr.id = v_item.product_id;
        IF COALESCE(v_name, '') = '' OR v_stock IS NULL THEN
          RAISE EXCEPTION 'No se pudo actualizar el stock de origen. Intenta de nuevo.';
        END IF;
        RAISE EXCEPTION 'Stock insuficiente de "%" en origen. Disponible: %, requerido: %',
          v_name, v_stock, v_item.quantity;
      END IF;
    ELSE
      UPDATE public.variant_stock s
         SET stock = s.stock - v_item.quantity, updated_at = now()
       WHERE s.variant_id = v_item.variant_id
         AND s.tenant_id = v_transfer.from_tenant_id
         AND s.stock >= v_item.quantity
      RETURNING s.stock INTO v_after;
      IF v_after IS NULL THEN
        SELECT v.label, s.stock INTO v_name, v_stock
          FROM public.product_variants v
          LEFT JOIN public.variant_stock s
            ON s.variant_id = v.id AND s.tenant_id = v_transfer.from_tenant_id
         WHERE v.id = v_item.variant_id;
        IF COALESCE(v_name, '') = '' OR v_stock IS NULL THEN
          RAISE EXCEPTION 'No se pudo actualizar el stock de origen. Intenta de nuevo.';
        END IF;
        RAISE EXCEPTION 'Stock insuficiente de "%" en origen. Disponible: %, requerido: %',
          v_name, v_stock, v_item.quantity;
      END IF;
    END IF;
    v_after := NULL;
    v_name := NULL;
    v_stock := NULL;
  END LOOP;

  INSERT INTO public.stock_history (tenant_id, product_id, variant_id, quantity, type, reason, created_by)
  SELECT v_transfer.from_tenant_id, it.product_id, it.variant_id, -it.quantity,
         'transfer', 'Transferencia a ' || v_transfer.to_tenant_id, p_by
    FROM public.stock_transfer_items it
   WHERE it.transfer_id = p_transfer_id;

  UPDATE public.stock_transfers
     SET status = 'in_transit', updated_at = now()
   WHERE id = v_transfer.id AND status = 'pending'
  RETURNING to_jsonb(stock_transfers.*) INTO v_row;

  IF v_row IS NOT NULL THEN
    RETURN QUERY SELECT true, NULL::TEXT, NULL::TEXT, v_row; RETURN;
  END IF;
  RETURN QUERY SELECT false, 'wrong_status', 'pending', NULL::JSONB;
END;
$$;

CREATE OR REPLACE FUNCTION receive_transfer(
  p_transfer_id UUID,
  p_by          UUID
)
RETURNS TABLE (ok BOOLEAN, code TEXT, current_status TEXT, "row" JSONB)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_transfer RECORD;
  v_item     RECORD;
  v_src_name TEXT;
  v_src_desc TEXT;
  v_src_icon TEXT;
  v_src_color TEXT;
  v_dst_cat  UUID;
  v_row      JSONB;
BEGIN
  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', NULL::TEXT, NULL::JSONB; RETURN;
  END IF;
  IF v_transfer.status <> 'in_transit' THEN
    RETURN QUERY SELECT false, 'wrong_status', v_transfer.status, NULL::JSONB; RETURN;
  END IF;

  FOR v_item IN
    SELECT it.product_id, it.variant_id, it.quantity,
           -- El código de una variante es SUYO: un barcode vacío no puede
           -- heredar el del padre y reservarlo en el tenant de destino.
           CASE WHEN it.variant_id IS NULL THEN p.sku ELSE v.sku END AS sku,
           CASE WHEN it.variant_id IS NULL THEN p.barcode ELSE v.barcode END AS barcode
      FROM public.stock_transfer_items it
      JOIN public.products p ON p.id = it.product_id
      LEFT JOIN public.product_variants v ON v.id = it.variant_id
     WHERE it.transfer_id = p_transfer_id
     ORDER BY it.product_id, COALESCE(it.variant_id, '00000000-0000-0000-0000-000000000000'::UUID)
  LOOP
    IF v_item.variant_id IS NULL AND EXISTS (
      SELECT 1 FROM public.product_variants v
        JOIN public.variant_stock s ON s.variant_id = v.id
       WHERE v.product_id = v_item.product_id
         AND s.tenant_id = v_transfer.to_tenant_id
         AND s.active
    ) THEN
      RAISE EXCEPTION 'El producto tiene variantes: transferí una variante';
    END IF;

    -- Categoria del origen, la mismma logica de la 071 (replica por nombre).
    SELECT c.name, c.description, c.icon, c.color
      INTO v_src_name, v_src_desc, v_src_icon, v_src_color
      FROM public.categories c
     WHERE c.id = COALESCE(
             (SELECT ps.category_id FROM public.product_stock ps
               WHERE ps.product_id = v_item.product_id
                 AND ps.tenant_id = v_transfer.from_tenant_id),
             (SELECT COALESCE(
                (SELECT s.category_id FROM public.variant_stock s
                  WHERE s.variant_id = v_item.variant_id
                    AND s.tenant_id = v_transfer.from_tenant_id),
                (SELECT p.category_id FROM public.products p WHERE p.id = v_item.product_id)
              ))
           );

    v_dst_cat := NULL;
    IF v_src_name IS NOT NULL THEN
      SELECT c.id INTO v_dst_cat
        FROM public.categories c
       WHERE c.tenant_id = v_transfer.to_tenant_id
         AND public.vynko_norm_name(c.name) = public.vynko_norm_name(v_src_name)
       ORDER BY c.created_at, c.id
       LIMIT 1;
      IF v_dst_cat IS NULL THEN
        INSERT INTO public.categories (tenant_id, name, description, icon, color)
        VALUES (v_transfer.to_tenant_id, v_src_name, v_src_desc, v_src_icon, v_src_color)
        ON CONFLICT (tenant_id, name) DO NOTHING
        RETURNING id INTO v_dst_cat;
        IF v_dst_cat IS NULL THEN
          SELECT c.id INTO v_dst_cat
            FROM public.categories c
           WHERE c.tenant_id = v_transfer.to_tenant_id
             AND public.vynko_norm_name(c.name) = public.vynko_norm_name(v_src_name)
           ORDER BY c.created_at, c.id
           LIMIT 1;
        END IF;
      END IF;
    END IF;

    IF v_item.variant_id IS NULL THEN
      INSERT INTO public.product_stock (product_id, tenant_id, stock, min_stock, max_stock, category_id)
      VALUES (v_item.product_id, v_transfer.to_tenant_id, v_item.quantity, 0, 0, v_dst_cat)
      ON CONFLICT (product_id, tenant_id)
      DO UPDATE SET stock = public.product_stock.stock + EXCLUDED.stock,
                    category_id = COALESCE(public.product_stock.category_id, EXCLUDED.category_id),
                    updated_at = now();
    ELSE
      INSERT INTO public.variant_stock (variant_id, tenant_id, stock, min_stock, max_stock, category_id)
      VALUES (v_item.variant_id, v_transfer.to_tenant_id, v_item.quantity, 0, 0, v_dst_cat)
      ON CONFLICT (variant_id, tenant_id)
      DO UPDATE SET stock = public.variant_stock.stock + EXCLUDED.stock,
                    category_id = COALESCE(public.variant_stock.category_id, EXCLUDED.category_id),
                    updated_at = now();
    END IF;

    -- El destino adopta los codigos: quedan registrados en su tenant para que
    -- no puedan ser reutilizados por otro articulo comercializable.
    PERFORM public.register_sellable_code(v_transfer.to_tenant_id, 'sku', v_item.sku,
                                           CASE WHEN v_item.variant_id IS NULL THEN v_item.product_id END,
                                           v_item.variant_id);
    PERFORM public.register_sellable_code(v_transfer.to_tenant_id, 'barcode', v_item.barcode,
                                           CASE WHEN v_item.variant_id IS NULL THEN v_item.product_id END,
                                           v_item.variant_id);
  END LOOP;

  INSERT INTO public.stock_history (tenant_id, product_id, variant_id, quantity, type, reason, created_by)
  SELECT v_transfer.to_tenant_id, it.product_id, it.variant_id, it.quantity,
         'transfer', 'Transferencia desde ' || v_transfer.from_tenant_id, p_by
    FROM public.stock_transfer_items it
   WHERE it.transfer_id = p_transfer_id;

  UPDATE public.stock_transfers
     SET status = 'received', received_at = now(), updated_at = now()
   WHERE id = v_transfer.id AND status = 'in_transit'
  RETURNING to_jsonb(stock_transfers.*) INTO v_row;

  IF v_row IS NOT NULL THEN
    RETURN QUERY SELECT true, NULL::TEXT, NULL::TEXT, v_row; RETURN;
  END IF;
  RETURN QUERY SELECT false, 'wrong_status', 'in_transit', NULL::JSONB;
END;
$$;

REVOKE ALL ON FUNCTION send_transfer(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION receive_transfer(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION send_transfer(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION receive_transfer(UUID, UUID) TO service_role;

-- ------------------------------------------------------------
-- 3. receive_po_stock (firma identica a 051)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION receive_po_stock(
  p_order_id UUID,
  p_tenant_id UUID,
  p_by UUID,
  p_items JSONB,
  p_received_date DATE,
  p_deposito TEXT,
  p_pasillo TEXT,
  p_estanteria TEXT
)
RETURNS TABLE (ok BOOLEAN, code TEXT, "row" JSONB)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_new_received INTEGER;
  v_all BOOLEAN := TRUE;
  v_status TEXT;
  v_received_at DATE;
  v_row JSONB;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Ocurrio un error inesperado. Intenta de nuevo.';
  END IF;

  SELECT * INTO v_order
    FROM public.purchase_orders
   WHERE id = p_order_id AND tenant_id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', NULL::JSONB; RETURN;
  END IF;
  IF v_order.status = 'received' THEN
    RETURN QUERY SELECT false, 'already_received', NULL::JSONB; RETURN;
  END IF;
  IF v_order.status = 'cancelled' THEN
    RETURN QUERY SELECT false, 'cancelled', NULL::JSONB; RETURN;
  END IF;

  FOR v_item IN
    SELECT it.id, it.product_id, it.variant_id, it.quantity_ordered, it.quantity_received,
           COALESCE(pr.name, 'Producto') AS product_name,
           COALESCE(v.label, '') AS variant_label,
           COALESCE(inc.qty, 0) AS inc
      FROM public.purchase_order_items it
      LEFT JOIN public.products pr ON pr.id = it.product_id
      LEFT JOIN public.product_variants v ON v.id = it.variant_id
      LEFT JOIN LATERAL (
        SELECT (e.value ->> 'quantity_received')::INTEGER AS qty
          FROM jsonb_array_elements(p_items) AS e
         WHERE (e.value ->> 'product_id')::UUID = it.product_id
           AND (NULLIF(e.value ->> 'variant_id', '')::UUID) IS NOT DISTINCT FROM it.variant_id
      ) inc ON TRUE
     WHERE it.purchase_order_id = p_order_id
     ORDER BY it.product_id,
              COALESCE(it.variant_id, '00000000-0000-0000-0000-000000000000'::UUID)
  LOOP
    IF v_item.inc IS NULL OR v_item.inc <= 0 THEN
      IF v_item.quantity_received < v_item.quantity_ordered THEN v_all := FALSE; END IF;
      CONTINUE;
    END IF;

    IF v_item.variant_id IS NULL AND EXISTS (
      SELECT 1 FROM public.product_variants v
        JOIN public.variant_stock s ON s.variant_id = v.id
       WHERE v.product_id = v_item.product_id
         AND s.tenant_id = p_tenant_id
         AND s.active
    ) THEN
      RAISE EXCEPTION 'El producto tiene variantes: recibí una variante';
    END IF;

    v_new_received := v_item.quantity_received + v_item.inc;
    IF v_new_received > v_item.quantity_ordered THEN
      RAISE EXCEPTION
        'No se puede recibir más de lo pedido para "%" (pedido: %, recibido: %, llegan: %)',
        CASE WHEN v_item.variant_label <> '' THEN v_item.variant_label ELSE v_item.product_name END,
        v_item.quantity_ordered, v_item.quantity_received, v_item.inc;
    END IF;

    UPDATE public.purchase_order_items
       SET quantity_received = v_new_received
     WHERE id = v_item.id;

    IF v_item.variant_id IS NULL THEN
      INSERT INTO public.product_stock (product_id, tenant_id, stock, min_stock, max_stock)
      VALUES (v_item.product_id, p_tenant_id, v_item.inc, 0, 0)
      ON CONFLICT (product_id, tenant_id)
      DO UPDATE SET stock = public.product_stock.stock + EXCLUDED.stock, updated_at = now();
      IF p_deposito IS NOT NULL THEN
        UPDATE public.product_stock SET deposito = p_deposito
         WHERE product_id = v_item.product_id AND tenant_id = p_tenant_id; END IF;
      IF p_pasillo IS NOT NULL THEN
        UPDATE public.product_stock SET pasillo = p_pasillo
         WHERE product_id = v_item.product_id AND tenant_id = p_tenant_id; END IF;
      IF p_estanteria IS NOT NULL THEN
        UPDATE public.product_stock SET estanteria = p_estanteria
         WHERE product_id = v_item.product_id AND tenant_id = p_tenant_id; END IF;
    ELSE
      INSERT INTO public.variant_stock (variant_id, tenant_id, stock, min_stock, max_stock)
      VALUES (v_item.variant_id, p_tenant_id, v_item.inc, 0, 0)
      ON CONFLICT (variant_id, tenant_id)
      DO UPDATE SET stock = public.variant_stock.stock + EXCLUDED.stock, updated_at = now();
      IF p_deposito IS NOT NULL THEN
        UPDATE public.variant_stock SET deposito = p_deposito
         WHERE variant_id = v_item.variant_id AND tenant_id = p_tenant_id; END IF;
      IF p_pasillo IS NOT NULL THEN
        UPDATE public.variant_stock SET pasillo = p_pasillo
         WHERE variant_id = v_item.variant_id AND tenant_id = p_tenant_id; END IF;
      IF p_estanteria IS NOT NULL THEN
        UPDATE public.variant_stock SET estanteria = p_estanteria
         WHERE variant_id = v_item.variant_id AND tenant_id = p_tenant_id; END IF;
    END IF;

    INSERT INTO public.stock_history (tenant_id, product_id, variant_id, quantity, type, reason, created_by)
    VALUES (p_tenant_id, v_item.product_id, v_item.variant_id, v_item.inc, 'in',
            'Recepción PO #' || SUBSTR(p_order_id::TEXT, 1, 8), p_by);

    IF v_new_received < v_item.quantity_ordered THEN v_all := FALSE; END IF;
  END LOOP;

  v_status := CASE WHEN v_all THEN 'received' ELSE 'partial' END;
  v_received_at := CASE WHEN v_all THEN COALESCE(p_received_date, now()::date) END;

  UPDATE public.purchase_orders
     SET status = v_status, received_date = v_received_at, updated_at = now()
   WHERE id = v_order.id
  RETURNING jsonb_build_object('status', status, 'received_date', received_date, 'all', v_all)
    INTO v_row;

  RETURN QUERY SELECT true, NULL::TEXT, v_row;
END;
$$;

REVOKE ALL ON FUNCTION receive_po_stock(UUID, UUID, UUID, JSONB, DATE, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION receive_po_stock(UUID, UUID, UUID, JSONB, DATE, TEXT, TEXT, TEXT) TO service_role;
