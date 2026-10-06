-- 050_transfer_status_atomic.sql
--
-- Mueve el cambio de estado de las transferencias (enviar/recibir) a una
-- transaccion por funcion. Enviar descuenta stock del origen, recibir lo
-- acredita en el destino, y el status pasa a in_transit/received en el MISMO
-- lote.
--
-- Por que hace falta: `updateTransferStatus` hacía el cambio de estado desde
-- JS como una secuencia de viajes separados:
--
--   1) SELECT transfer (status 'pending')
--   2) por item: SELECT stock -> UPDATE stock = <leido> - qty  (CAS con 5
--      reintentos por item)
--   3) UPDATE stock_transfers SET status = 'in_transit'
--   4) INSERT stock_history (origen) por item
--
-- Tres fallas de la secuencia:
--
--   - DOS requests simultaneos sobre la MISMA transferencia leen 'pending'
--     cada uno, deducen el stock con su CAS (el perdedor del CAS relee y
--     deduce SOBRE el valor del ganador) y los DOS escriben 'in_transit':
--     el stock del origen se descuenta DOS veces para UNA transferencia.
--   - el reintento por item es el mismo retry-loop que 043 documento: bajo
--     concurrencia real se agota y falla con 409 "No se pudo actualizar el
--     stock de origen", a veces cuando el stock alcanza.
--   - si el proceso muere entre el debito del origen y el UPDATE del status,
--     el stock quedo descontado y la transferencia sigue 'pending'; si muere
--     a la mitad de los items, una parte quedo descontada y el resto no.
--
-- Aca el UPDATE de status con guarda (`status = 'pending'` bajo `FOR UPDATE`)
-- se ejecuta PRIMERO: dos envios simultaneos se serializan sobre la fila y el
-- segundo ve el status cambiado, asi que el debito no puede duplicarse. El
-- chequeo de stock vuelve a vivir DENTRO del UPDATE (`stock >= qty`), y todo
-- el bloque (debitos + historial + status) es UNA transaccion: cualquier
-- fallo revierte el lote entero.
--
-- Los mensajes de error se conservan al pie de la letra: son los que el front
-- ya sabe mostrar. Los errores de stock se levantan con `RAISE` (abortan la
-- transaccion y revierten los debitos ya hechos), y el backend los propaga.
--
-- SECURITY INVOKER como 043/049: el caller ya es la service role, que sortea
-- el RLS; INVOKER evita la escalacion de privilegios.

-- ============================================================
-- send_transfer
-- ============================================================

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
  -- Lock de fila desde el arranque: dos 'enviar' simultaneos se serializan aca
  -- y el perdedor ve el status ya cambiado en el chequeo de abajo.
  SELECT * INTO v_transfer
    FROM public.stock_transfers
   WHERE id = p_transfer_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', NULL::TEXT, NULL::JSONB;
    RETURN;
  END IF;

  -- La app ya valido la transicion; aca se re-chequea porque el status que ella
  -- leyo puede ser una foto vieja. Es la guarda que evita el doble debito.
  IF v_transfer.status <> 'pending' THEN
    RETURN QUERY SELECT false, 'wrong_status', v_transfer.status, NULL::JSONB;
    RETURN;
  END IF;

  -- Items ordenados por product_id a proposito: dos transferencias concurrentes
  -- (envio de una, recepcion de otra) tocan filas de stock de tenants
  -- distintos, pero si dos envios comparten productos, toman los locks en el
  -- MISMO orden y no hay deadlock (mismo criterio que 048 para la venta).
  FOR v_item IN
    SELECT it.product_id, it.quantity
      FROM public.stock_transfer_items it
     WHERE it.transfer_id = p_transfer_id
     ORDER BY it.product_id
  LOOP
    -- `stock >= qty` DENTRO del UPDATE: validacion y descuento en una sola
    -- sentencia bajo el lock de fila, como decrement_stock (043).
    UPDATE public.product_stock ps
       SET stock = ps.stock - v_item.quantity,
           updated_at = now()
     WHERE ps.product_id = v_item.product_id
       AND ps.tenant_id = v_transfer.from_tenant_id
       AND ps.stock >= v_item.quantity
    RETURNING ps.stock INTO v_after;

    IF v_after IS NULL THEN
      -- Releer para distinguir "no alcanza" de "no hay fila para este tenant",
      -- y resolver el nombre del producto para el mensaje.
      SELECT pr.name, ps.stock
        INTO v_name, v_stock
        FROM public.products pr
        LEFT JOIN public.product_stock ps
          ON ps.product_id = pr.id AND ps.tenant_id = v_transfer.from_tenant_id
       WHERE pr.id = v_item.product_id;

      IF v_name IS NULL THEN
        RAISE EXCEPTION 'No se pudo actualizar el stock de origen. Intenta de nuevo.';
      END IF;
      IF v_stock IS NULL THEN
        RAISE EXCEPTION 'No se pudo actualizar el stock de origen. Intenta de nuevo.';
      END IF;
      RAISE EXCEPTION
        'Stock insuficiente de "%" en origen. Disponible: %, requerido: %',
        v_name, v_stock, v_item.quantity;
    END IF;
    v_after := NULL;
  END LOOP;

  -- Bitacora del origen, en la misma transaccion que el debito.
  INSERT INTO public.stock_history (tenant_id, product_id, quantity, type, reason, created_by)
  SELECT
    v_transfer.from_tenant_id,
    it.product_id,
    -it.quantity,
    'transfer',
    'Transferencia a ' || v_transfer.to_tenant_id,
    p_by
  FROM public.stock_transfer_items it
  WHERE it.transfer_id = p_transfer_id;

  -- La transicion, con la misma guarda del lock. Cualquier RAISE anterior (o
  -- este UPDATE fallido) revierte TODO el lote.
  UPDATE public.stock_transfers
     SET status = 'in_transit',
         updated_at = now()
   WHERE id = v_transfer.id
     AND status = 'pending'
  RETURNING to_jsonb(stock_transfers.*) INTO v_row;

  -- La fila YA estaba lockeada y en 'pending', asi que el UPDATE siempre
  -- matchea; el guard es por defensa en profundidad.
  IF v_row IS NOT NULL THEN
    RETURN QUERY SELECT true, NULL::TEXT, NULL::TEXT, v_row;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, 'wrong_status', 'pending', NULL::JSONB;
END;
$$;

-- ============================================================
-- receive_transfer
-- ============================================================

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
  v_row      JSONB;
BEGIN
  -- Mismo lock inicial que send_transfer: dos recepciones simultaneas se
  -- serializan y la perdedora ve el status ya 'received'.
  SELECT * INTO v_transfer
    FROM public.stock_transfers
   WHERE id = p_transfer_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', NULL::TEXT, NULL::JSONB;
    RETURN;
  END IF;

  IF v_transfer.status <> 'in_transit' THEN
    RETURN QUERY SELECT false, 'wrong_status', v_transfer.status, NULL::JSONB;
    RETURN;
  END IF;

  -- La acreditacion en destino es un upsert en UNA sentencia: si la fila ya
  -- existe suma, si no la crea. El `ON CONFLICT (product_id, tenant_id)`
  -- depende del mismo unique index que el codigo viejo usaba para detectar la
  -- colision con 23505. No hay carrera posible: esta transferencia es la unica
  -- que puede acreditar, porque su fila esta lockeada.
  FOR v_item IN
    SELECT it.product_id, it.quantity
      FROM public.stock_transfer_items it
     WHERE it.transfer_id = p_transfer_id
     ORDER BY it.product_id
  LOOP
    INSERT INTO public.product_stock (product_id, tenant_id, stock, min_stock, max_stock)
    VALUES (v_item.product_id, v_transfer.to_tenant_id, v_item.quantity, 0, 0)
    ON CONFLICT (product_id, tenant_id)
    DO UPDATE
       SET stock = public.product_stock.stock + EXCLUDED.stock,
           updated_at = now();
  END LOOP;

  -- Bitacora del destino, en la misma transaccion que la acreditacion.
  INSERT INTO public.stock_history (tenant_id, product_id, quantity, type, reason, created_by)
  SELECT
    v_transfer.to_tenant_id,
    it.product_id,
    it.quantity,
    'transfer',
    'Transferencia desde ' || v_transfer.from_tenant_id,
    p_by
  FROM public.stock_transfer_items it
  WHERE it.transfer_id = p_transfer_id;

  UPDATE public.stock_transfers
     SET status = 'received',
         received_at = now(),
         updated_at = now()
   WHERE id = v_transfer.id
     AND status = 'in_transit'
  RETURNING to_jsonb(stock_transfers.*) INTO v_row;

  IF v_row IS NOT NULL THEN
    RETURN QUERY SELECT true, NULL::TEXT, NULL::TEXT, v_row;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, 'wrong_status', 'in_transit', NULL::JSONB;
END;
$$;

REVOKE ALL ON FUNCTION send_transfer(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION send_transfer(UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION send_transfer(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION receive_transfer(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION receive_transfer(UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION receive_transfer(UUID, UUID) TO service_role;