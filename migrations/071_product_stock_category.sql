-- 071_product_stock_category.sql
--
-- Categoría por sucursal: `product_stock.category_id`.
--
-- Por qué hace falta: `products` es una tabla GLOBAL compartida entre
-- sucursales (migración 016), pero `categories` es por-tenant. El único lugar
-- donde vivía la categoría de un producto era `products.category_id`, que
-- apunta a UNA categoría de UNA sucursal. Para cualquier otra sucursal que
-- tiene ese producto en su catálogo (vía `product_stock`) la categoría no
-- resuelve: el listado compara contra las categorías del tenant activo y
-- muestra "Sin categoría". Era exactamente el síntoma de recibir una
-- transferencia: el producto entra al catálogo de la sucursal destino con la
-- categoría de la origen, que para el destino es invisible.
--
-- La categoría pasa a vivir donde vive el catálogo de cada sucursal:
-- `product_stock.category_id`. `products.category_id` se sigue escribiendo
-- (respaldo global y fuente de la réplica), pero el listado lee la del tenant.
--
-- Además `receive_transfer` replica la categoría al destino: busca en las
-- categorías del tenant destino una con el mismo nombre normalizado (sin
-- acentos ni case, mismo criterio que `normalizeForSearch` en TS) y si no
-- existe la crea con el mismo nombre/descripción/icono/color. Así una
-- transferencia llega CON su categoría.
--
-- ORDEN DE DEPLOY: esta migración va ANTES que el código que la usa (el select
-- de `listProducts` pide la columna nueva; sin ella /api/products rompe con
-- PGRST108). Migración-first es backward compatible: el código viejo no
-- selecciona la columna nueva y `receive_transfer` mantiene firma y contrato.

-- 1. Columna por-tenant de categoría en el catálogo de cada sucursal.
ALTER TABLE public.product_stock
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL;

-- 2. Backfill: la categoría global del producto sólo es "visible" para el
--    tenant dueño de esa categoría. Para el resto queda NULL — antes esos
--    productos mostraban "Sin categoría" igual, porque la categoría no les
--    pertenecía.
UPDATE public.product_stock ps
   SET category_id = p.category_id
  FROM public.products p
 WHERE p.id = ps.product_id
   AND p.category_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.categories c
      WHERE c.id = p.category_id
        AND c.tenant_id = ps.tenant_id
   );

-- 3. Normalización de nombres para matchear/crear categorías replicadas: sin
--    acentos y en minúsculas, como `normalizeForSearch` en TS. Inmutable y
--    parallel-safe para poder usarse en filtros e índices.
CREATE OR REPLACE FUNCTION public.vynko_norm_name(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(translate(p_text,
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÑñÇçÝýÿ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuNnCcYyy'));
$$;

-- 4. receive_transfer con réplica de categoría. Todo lo demás es el cuerpo de
--    la 050: mismo lock, mismos códigos de error, misma bitácora.
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
    -- Categoria del producto EN EL ORIGEN: la de su fila de catalogo si ya la
    -- tiene (la migracion 016 la reparte por tenant), si no la global del
    -- producto. Es la que se replica al destino.
    SELECT c.name, c.description, c.icon, c.color
      INTO v_src_name, v_src_desc, v_src_icon, v_src_color
      FROM public.categories c
     WHERE c.id = COALESCE(
             (SELECT ps.category_id
                FROM public.product_stock ps
               WHERE ps.product_id = v_item.product_id
                 AND ps.tenant_id = v_transfer.from_tenant_id),
             (SELECT p.category_id
                FROM public.products p
               WHERE p.id = v_item.product_id)
           );

    v_dst_cat := NULL;
    IF v_src_name IS NOT NULL THEN
      -- Misma categoria (por nombre normalizado) en el destino, si ya existe.
      SELECT c.id INTO v_dst_cat
        FROM public.categories c
       WHERE c.tenant_id = v_transfer.to_tenant_id
         AND public.vynko_norm_name(c.name) = public.vynko_norm_name(v_src_name)
       ORDER BY c.created_at, c.id
       LIMIT 1;

      IF v_dst_cat IS NULL THEN
        -- No existe en el destino: se crea con el mismo nombre/icono/color.
        -- El ON CONFLICT cubre la carrera con otra transferencia simultanea
        -- al mismo tenant; en ese caso se vuelve a seleccionar.
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

    INSERT INTO public.product_stock (product_id, tenant_id, stock, min_stock, max_stock, category_id)
    VALUES (v_item.product_id, v_transfer.to_tenant_id, v_item.quantity, 0, 0, v_dst_cat)
    ON CONFLICT (product_id, tenant_id)
    DO UPDATE
       SET stock = public.product_stock.stock + EXCLUDED.stock,
           -- No pisa la categoria si el destino ya eligio una propia; si
           -- completa la que falta (transferencias previas a esta migracion,
           -- que acreditaban sin categoria).
           category_id = COALESCE(public.product_stock.category_id, EXCLUDED.category_id),
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

REVOKE ALL ON FUNCTION vynko_norm_name(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION vynko_norm_name(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION vynko_norm_name(TEXT) TO service_role;
