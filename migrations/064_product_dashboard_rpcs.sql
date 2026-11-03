-- ============================================================
-- 064: RPCs livianas para el dashboard de productos
-- ============================================================
--
-- 1) `get_critical_products`: antes `/api/products/critical` traia el
--    catalogo COMPLETO con un join a `product_stock` y filtraba
--    `stock <= min_stock` en JS. Con un catalogo grande se transferian y
--    parseaban miles de filas para terminar mostrando unas pocas. Ademas el
--    filtro leia solo `stock_data[0]`, asi que en modo "todas las sucursales"
--    un producto critico en una sucursal podia quedar afuera segun el orden
--    en que PostgREST devolvia el join.
--
--    La funcion devuelve SOLO las filas criticas y resuelve el caso
--    multi-sucursal con `DISTINCT ON (product_id)`: si el mismo producto esta
--    critico en varias sucursales aparece UNA vez, con el stock mas critico
--    (el deficit mas negativo). Mantiene el shape `{ id, name, stock,
--    min_stock }` que ya consume el dashboard.
--
-- 2) `get_product_counters`: el dashboard solo necesita el total de productos
--    y si hay alguna alerta configurada. Eran dos COUNT separados; con una
--    sola pasada sobre `product_stock` se obtienen ambos valores.
--
-- Ambas son STABLE + SECURITY INVOKER y quedan revocadas de anon/authenticated:
-- la app las llama con service_role, igual que el resto de las RPC de 049-051.
-- ============================================================

-- Indice parcial: la consulta de criticos solo mira filas activas con
-- stock <= min_stock, asi que el indice no crece con el catalogo entero.
CREATE INDEX IF NOT EXISTS idx_product_stock_tenant_critical
  ON public.product_stock (tenant_id)
  WHERE active AND stock <= min_stock;

CREATE OR REPLACE FUNCTION get_critical_products(p_tenant_ids UUID[])
RETURNS TABLE (id UUID, name TEXT, stock INTEGER, min_stock INTEGER)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.id, c.name, c.stock, c.min_stock
    FROM (
      SELECT DISTINCT ON (p.id)
             p.id,
             p.name,
             ps.stock,
             ps.min_stock,
             (ps.stock - ps.min_stock) AS deficit
        FROM public.product_stock ps
        JOIN public.products p ON p.id = ps.product_id
       WHERE ps.tenant_id = ANY (p_tenant_ids)
         AND ps.active = true
         AND ps.stock <= ps.min_stock
       -- El primer registro por producto es el de mayor deficit (mas negativo).
       ORDER BY p.id, (ps.stock - ps.min_stock) ASC
    ) c
   ORDER BY c.deficit ASC, c.name ASC;
$$;

REVOKE ALL ON FUNCTION get_critical_products(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_critical_products(UUID[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION get_critical_products(UUID[]) TO service_role;

CREATE OR REPLACE FUNCTION get_product_counters(p_tenant_ids UUID[])
RETURNS TABLE (product_count BIGINT, alerts_configured BOOLEAN)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::BIGINT AS product_count,
    COALESCE(BOOL_OR(ps.min_stock > 0 OR ps.max_stock > 0), false) AS alerts_configured
  FROM public.product_stock ps
  WHERE ps.tenant_id = ANY (p_tenant_ids)
    AND ps.active = true;
$$;

REVOKE ALL ON FUNCTION get_product_counters(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_product_counters(UUID[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION get_product_counters(UUID[]) TO service_role;
