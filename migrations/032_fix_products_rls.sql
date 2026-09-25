-- ========================================
-- Security Fix: Restrict products RLS
-- Migration: 032_fix_products_rls.sql
-- ========================================
--
-- products es una tabla "global" (sin tenant_id, ver 016). Las mutaciones
-- pasan exclusivamente por API routes con service_role, así que las políticas
-- DML de "cualquier usuario autenticado" exponían el catálogo/operaciones a
-- cualquier tenant vía la clave anónima + JWT del usuario.
--
-- Se eliminan las políticas DML globales y se restringe el SELECT a los
-- tenants del usuario mediante la tabla product_stock (que sí es por-tenant).
-- El service_role sigue operando sin RLS (sin cambios de comportamiento).

-- 1. Drop global policies creadas en 016_product_stock.sql
DROP POLICY IF EXISTS "All authenticated users can view products" ON products;
DROP POLICY IF EXISTS "Authenticated users can insert products" ON products;
DROP POLICY IF EXISTS "Authenticated users can update products" ON products;
DROP POLICY IF EXISTS "Authenticated users can delete products" ON products;

-- 2. SELECT de productos scoped a los tenants del usuario (vía product_stock)
DROP POLICY IF EXISTS "Users can view their tenant products" ON products;
CREATE POLICY "Users can view their tenant products" ON products
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM product_stock
      WHERE product_stock.product_id = products.id
        AND product_stock.tenant_id IN (
          SELECT tenant_id
          FROM tenant_users
          WHERE user_id = auth.uid()
        )
    )
  );

-- 3. Sin políticas de INSERT/UPDATE/DELETE: mutaciones solo via service_role
--    (es el patrón que toda la app ya usa).