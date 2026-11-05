-- ========================================
-- 067 - Una membresia inactiva no puede leer el tenant
-- ========================================
-- `066` agrego `tenant_users.status` ('active' | 'inactive') para desactivar a
-- alguien sin borrar su historial. El backend ya filtraba `status` en
-- `getAuth`/`/api/session`, pero las policies de RLS seguian mirando solo
-- `user_id`: un colaborador desactivado conservaba acceso de LECTURA directo
-- por PostgREST (products, sales, activity_logs) y por Storage (imagenes del
-- tenant) usando la anon key + su JWT.
--
-- La correccion es en dos capas:
--
--   1. La policy SELECT de `tenant_users` solo muestra filas activas del propio
--      usuario. Como todas las policies viejas (001, 020, 005, 006, ...)
--      resuelven el tenant con subqueries `FROM tenant_users WHERE
--      user_id = auth.uid()`, esas subqueries quedan sujetas a esta policy y
--      dejan de devolver tenants donde la persona esta inactiva. No hace falta
--      reescribir una por una.
--
--   2. Los helpers `current_user_tenant_ids()` y `current_user_tenant_role()`
--      son SECURITY DEFINER (corren como el dueno y NO pasan por RLS), asi que
--      se recrean con el filtro `status = 'active'` explicito. Son los que usan
--      Storage, suppliers, stock_movements y notificaciones.
--
-- Ademas se agrega la revocacion best-effort de las sesiones de auth cuando la
-- persona queda sin ninguna membresia activa. Sin esto, el refresh token sigue
-- vivo y puede seguir renovando la cookie aunque el backend niegue el tenant.
--
-- Idempotente: se puede re-aplicar sin efectos duplicados.
-- ========================================

-- ========================================
-- 1. Helpers con membresia activa
-- ========================================
CREATE OR REPLACE FUNCTION public.current_user_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id
  FROM public.tenant_users
  WHERE user_id = auth.uid()
    AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.current_user_tenant_role(target_tenant uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role
  FROM public.tenant_users
  WHERE user_id = auth.uid()
    AND tenant_id = target_tenant
    AND status = 'active';
$$;

-- Los CREATE OR REPLACE conservan los grants existentes, pero se repiten para
-- que una base recreada desde cero quede con el mismo contrato que produccion.
REVOKE ALL ON FUNCTION public.current_user_tenant_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_tenant_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_role(uuid) TO authenticated, service_role;

-- ========================================
-- 2. `tenant_users`: el usuario solo ve su propia fila activa
-- ========================================
-- No se toca la policy de `service_role_all` (034): el backend sigue viendo
-- todas las membresias para administrarlas.
DROP POLICY IF EXISTS "Users can view tenant members" ON public.tenant_users;
CREATE POLICY "Users can view tenant members" ON public.tenant_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND status = 'active');

-- ========================================
-- 3. activity_logs: misma fuente de verdad
-- ========================================
-- La policy original (010) consulta `tenant_users` directo, asi que hereda la
-- policy de arriba. Se recrea igual para dejar explicito el filtro y para que
-- no dependa de que una migracion futura vuelva a abrir `tenant_users`.
DROP POLICY IF EXISTS "tenant_select" ON public.activity_logs;
CREATE POLICY "tenant_select" ON public.activity_logs
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- ========================================
-- 4. Revocacion de sesiones sin membresia activa
-- ========================================
-- Supabase Auth no expone un "revocar todas las sesiones de este user_id" por
-- API. La unica forma atomica es borrar las filas de `auth.sessions` (y sus
-- refresh tokens) desde SQL. Es SECURITY DEFINER porque `authenticated` no
-- tiene privilegios sobre el esquema auth.
--
-- La condicion de "sin ninguna membresia activa" es deliberada: desactivar en
-- una sucursal no debe cerrar la sesion de alguien que sigue activo en otra.
-- Los `to_regclass` permiten correr la migracion en instalaciones self-hosted
-- con un esquema auth distinto sin romper el archivo.
CREATE OR REPLACE FUNCTION public.revoke_user_sessions_if_no_active_membership(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenant_users
    WHERE user_id = p_user_id
      AND status = 'active'
  ) THEN
    RETURN false;
  END IF;

  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id;
  END IF;

  IF to_regclass('auth.sessions') IS NOT NULL THEN
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_user_sessions_if_no_active_membership(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_user_sessions_if_no_active_membership(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_sessions_if_no_active_membership(uuid) TO service_role;
