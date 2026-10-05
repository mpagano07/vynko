-- 043_atomic_stock_decrement.sql
--
-- Agrega `decrement_stock`: descuenta stock en UNA sola sentencia atomica.
--
-- Por que hace falta: `createSale` hacia el descuento con un compare-and-swap
-- desde JS:
--
--   SELECT stock           -- lee
--   UPDATE ... WHERE stock = <lo leido>   -- si otro.writer gano, no matchea
--   (reintentar hasta 5 veces)
--
-- Con N ventas concurrentes sobre el MISMO producto, Postgres serializa los
-- UPDATE por el lock de fila, asi que el SELECT de todos devuelve el mismo
-- valor y solo uno gana la primera ronda. Cada unlucky tiene que reintentar, y
-- los intentos competes entre si: el numero de rondas necesario crece con la
-- concurrencia, no es constante.
--
-- Con 5 intentos, 20 ventas simultaneas del mismo producto agotaban los
-- reintentos y la venta fallaba con 400 "Demasiada concurrencia sobre ...".
-- Medido con scripts/load-test-sales.mjs: de 20 ventas concurrentes sobre un
-- producto con stock de sobra, 7 fallaban con ese error. No era falta de stock
-- (habia 80 unidades) ni un problema de performance: era el retry loop que se
-- rindia antes de que la fila se liberara.
--
-- Con la funcion, el `UPDATE ... WHERE stock >= p_quantity` se evalua bajo el
-- lock de fila: los N clientes se serializan (eso es inevitable, es la fila) pero
-- TODOS tienen exito mientras quede stock. Sin reintentos, sin carrera, y en un
-- round trip en vez de dos por intento.
--
-- La validacion de stock sigue existiendo en `createSale` antes de escribir
-- nada (lee `product_stock` y falla temprano con el mensaje de "Stock
-- insuficiente"); esta funcion cubre el caso residual, que es que el stock haya
-- cambiado entre esa lectura y el descuento.

CREATE OR REPLACE FUNCTION decrement_stock(
  p_product_id UUID,
  p_tenant_id  UUID,
  p_quantity   INTEGER
)
-- `stock` es el valor RESULTANTE cuando ok=true, y el stock ACTUAL cuando
-- ok=false, para que el mensaje de error pueda decir cuanto habia.
RETURNS TABLE (ok BOOLEAN, stock INTEGER)
LANGUAGE plpgsql
-- INVOKER por el mismo motivo que en rate_limit_peek: permite validar con
-- `current_user` quien llama y evita la escalacion de privilegios.
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_stock INTEGER;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'decrement_stock: p_quantity must be > 0, got %', p_quantity;
  END IF;

  -- El `stock >= p_quantity` va DENTRO del UPDATE: es lo que hace atomica la
  -- comprobacion con el descuento. Si se leyera antes en un SELECT, el check y
  -- el write quedarian separados y volveria a haber la carrera.
  UPDATE public.product_stock ps
     SET stock = ps.stock - p_quantity,
         updated_at = now()
   WHERE ps.product_id = p_product_id
     AND ps.tenant_id = p_tenant_id
     AND ps.stock >= p_quantity
  RETURNING ps.stock INTO v_stock;

  IF v_stock IS NOT NULL THEN
    RETURN QUERY SELECT true, v_stock;
    RETURN;
  END IF;

  -- No desconto: o no hay fila para ese producto en ese tenant, o el stock no
  -- alcanza. Se relee para poder distinguir los dos casos en el mensaje.
  SELECT ps.stock
    INTO v_stock
    FROM public.product_stock ps
   WHERE ps.product_id = p_product_id
     AND ps.tenant_id = p_tenant_id;

  RETURN QUERY SELECT false, v_stock;
END $$;

-- Mismo permissions que 036/037. El revoke de anon y authenticated no es
-- opcional: Supabase aplica ALTER DEFAULT PRIVILEGES que otorga EXECUTE sobre
-- funciones nuevas del schema public a esos dos roles con permiso DIRECTO, asi
-- que revocar solo de PUBLIC deja el ACL abierto.
REVOKE ALL ON FUNCTION decrement_stock(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION decrement_stock(UUID, UUID, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION decrement_stock(UUID, UUID, INTEGER) TO service_role;

-- `increment_stock` es el camino de vuelta del rollback, por si una venta se
-- completa a medias y hay que devolver el stock. Hace falta una funcion propia
-- y no un `UPDATE` de PostgREST porque sumar no se puede expresar como
-- `stock = <valor leido>`: hay que leer el valor, y entre la lectura y el write
-- otra venta puede moverlo.
--
-- Sin esto el rollback usaba el mismo compare-and-swap con 5 reintentos. Como
-- sumar no necesita comprobar nada (siempre "gana"), los reintentos no
-- compraban nada: agregaban hasta 10 round trips al camino de error y, agotados
-- los 5 intentos, el stock se perdia sin avisar.
CREATE OR REPLACE FUNCTION increment_stock(
  p_product_id UUID,
  p_tenant_id  UUID,
  p_quantity   INTEGER
)
RETURNS TABLE (ok BOOLEAN, stock INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_stock INTEGER;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'increment_stock: p_quantity must be > 0, got %', p_quantity;
  END IF;

  UPDATE public.product_stock ps
     SET stock = ps.stock + p_quantity,
         updated_at = now()
   WHERE ps.product_id = p_product_id
     AND ps.tenant_id = p_tenant_id
  RETURNING ps.stock INTO v_stock;

  IF v_stock IS NULL THEN
    -- No hay fila para ese producto en ese tenant: no hay nada que restituir.
    -- El cast es explicito porque `NULL` a secas es ambiguo en un `RETURN
    -- QUERY` de una funcion que devuelve TABLE.
    RETURN QUERY SELECT false, NULL::INTEGER;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_stock;
END $$;

REVOKE ALL ON FUNCTION increment_stock(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_stock(UUID, UUID, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_stock(UUID, UUID, INTEGER) TO service_role;
