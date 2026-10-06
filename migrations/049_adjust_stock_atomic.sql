-- 049_adjust_stock_atomic.sql
--
-- Agrega `adjust_stock_atomic`: ajusta stock y escribe el movimiento en UNA
-- sola transaccion, con el chequeo de no-negativo DENTRO del UPDATE.
--
-- Por que hace falta: `adjustProductStock` hacia un read-modify-write desde JS:
--
--   SELECT stock
--   compute newStock = currentStock + quantity   (rechaza si queda negativo)
--   UPDATE ... SET stock = <newStock>            (write ciego sobre el valor leido)
--
-- Dos ajustes concurrentes sobre el mismo producto leen el mismo stock, calculan
-- cada uno su propio `newStock` y el segundo write pisa al primero: el ajuste
-- que llego "despues" se pierde. Es la misma clase de carrera que 043 documento
-- para el descuento de venta, pero aca el UPDATE no es condicional y nadie
-- jamas lo reintenta, asi que el dato se pierde en silencio.
--
-- Con la funcion, `ps.stock + p_quantity >= 0` se evalua bajo el lock de fila
-- del UPDATE: los ajustes concurrentes se serializan y cada uno corre sobre el
-- valor REAL del momento, no sobre una foto vieja.
--
-- Ademas el movimiento de `stock_history` se escribe en la misma transaccion
-- (como en 048 para la venta): antes era un INSERT aparte, y si fallaba, el
-- stock quedaba ajustado sin movimiento verificable, con solo una advertencia
-- en la respuesta que casi nadie leia.
--
-- El contrato de error es el mismo que `decrement_stock` (043): no se hace
-- `RAISE` por un ajuste que deja el stock en negativo; se devuelve `ok=false`
-- con el stock actual en `old_stock`, para que el caller distinga "no alcanza"
-- de "no hay fila para este tenant" (both -> old_stock NULL = sin fila).
--
-- SECURITY INVOKER como 036/037/048: permite validar con `current_user` quien
-- llama y evita la escalacion de privilegios.

CREATE OR REPLACE FUNCTION adjust_stock_atomic(
  p_product_id UUID,
  p_tenant_id  UUID,
  p_quantity   INTEGER,
  p_reason     TEXT,
  p_created_by UUID
)
RETURNS TABLE (ok BOOLEAN, old_stock INTEGER, new_stock INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_new INTEGER;
BEGIN
  IF p_quantity IS NULL OR p_quantity = 0 THEN
    RAISE EXCEPTION 'adjust_stock_atomic: p_quantity must not be 0, got %', p_quantity;
  END IF;

  -- El chequeo `stock + p_quantity >= 0` va DENTRO del UPDATE: es lo que hace
  -- atomica la validacion con el write. Si se leyera antes, el check y el
  -- write quedarian separados y volveria la carrera que esta funcion elimina.
  UPDATE public.product_stock ps
     SET stock = ps.stock + p_quantity,
         updated_at = now()
   WHERE ps.product_id = p_product_id
     AND ps.tenant_id = p_tenant_id
     AND ps.stock + p_quantity >= 0
  RETURNING ps.stock INTO v_new;

  IF v_new IS NOT NULL THEN
    -- El movimiento se registra en la MISMA transaccion que el ajuste: si el
    -- stock cambio, el historial cambio con el. Un `stock_history` fallido no
    -- deja un ajuste silencioso sin registro.
    INSERT INTO public.stock_history (
      tenant_id,
      product_id,
      quantity,
      type,
      reason,
      created_by
    ) VALUES (
      p_tenant_id,
      p_product_id,
      p_quantity,
      'adjustment',
      p_reason,
      p_created_by
    );

    RETURN QUERY SELECT true, v_new - p_quantity, v_new;
    RETURN;
  END IF;

  -- No ajusto: o no hay fila para ese producto en ese tenant, o el ajuste
  -- dejaria el stock en negativo. Se relee para distinguir los dos casos.
  SELECT ps.stock
    INTO v_new
    FROM public.product_stock ps
   WHERE ps.product_id = p_product_id
     AND ps.tenant_id = p_tenant_id;

  IF v_new IS NOT NULL THEN
    RETURN QUERY SELECT false, v_new, NULL::INTEGER;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, NULL::INTEGER, NULL::INTEGER;
END $$;

REVOKE ALL ON FUNCTION adjust_stock_atomic(UUID, UUID, INTEGER, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION adjust_stock_atomic(UUID, UUID, INTEGER, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION adjust_stock_atomic(UUID, UUID, INTEGER, TEXT, UUID) TO service_role;