-- ============================================================
-- 069: progreso del checklist de onboarding
-- ============================================================
--
-- `get_product_counters` (migración 064) resolvía el total de productos y si
-- había alertas configuradas. El checklist "Primeros pasos" ahora sigue el
-- recorrido completo de una cuenta nueva y necesita dos señales más:
--
--   * `has_stock`: el tenant ya cargó cantidades en al menos un producto.
--   * `has_imported`: existe al menos un intento de importación de Excel
--     registrado en `activity_logs` (`entity_type = 'import'`).
--
-- Se mantienen las columnas anteriores para no romper consumidores y se
-- respeta el índice existente `idx_activity_logs_entity_type (tenant_id,
-- entity_type)`. La función sigue siendo STABLE + SECURITY INVOKER y sólo la
-- ejecuta service_role.
-- ============================================================

-- `CREATE OR REPLACE` no puede cambiar el tipo de retorno de una función
-- existente (Postgres 42P13). Como acá se agregan dos columnas al OUT, hay que
-- dropearla y recrearla. El DROP también limpia los GRANT viejos; se vuelven a
-- otorgar al final.
DROP FUNCTION IF EXISTS get_product_counters(UUID[]);

CREATE FUNCTION get_product_counters(p_tenant_ids UUID[])
RETURNS TABLE (
  product_count BIGINT,
  alerts_configured BOOLEAN,
  has_stock BOOLEAN,
  has_imported BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::BIGINT AS product_count,
    COALESCE(BOOL_OR(ps.min_stock > 0 OR ps.max_stock > 0), false) AS alerts_configured,
    COALESCE(BOOL_OR(ps.stock > 0), false) AS has_stock,
    EXISTS (
      SELECT 1
        FROM public.activity_logs al
       WHERE al.tenant_id = ANY (p_tenant_ids)
         AND al.entity_type = 'import'
    ) AS has_imported
  FROM public.product_stock ps
  WHERE ps.tenant_id = ANY (p_tenant_ids)
    AND ps.active = true;
$$;

REVOKE ALL ON FUNCTION get_product_counters(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_product_counters(UUID[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION get_product_counters(UUID[]) TO service_role;
