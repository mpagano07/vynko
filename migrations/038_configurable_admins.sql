-- ============================================================
-- 038: Admin configurable por flag en profiles
--
-- Reemplaza el admin hardcodeado en dos lugares:
--   1. `public.is_admin()` (definido en 026, recreado en 034) comparaba el
--      email contra un literal: 'matias.pagano07@gmail.com'.
--   2. `src/lib/admin.ts` hacia lo mismo en TypeScript, para la pagina de
--      analytics y el link del sidebar.
--
-- El literal era un problema mas alla de la rigidez: para darle admin a
-- alguien habia que editar codigo y desplegar. Y un email en un repositorio
-- es un dato personal travelling por el historial de git de forma permanente.
--
-- QUE NO HACE ESTA MIGRACION
-- ---------------------------
-- No agrega ningun admin nuevo. Solo mueve la fuente de verdad a una columna
-- y siembra el valor que el hardcodeado ya tenia, para que al aplicar esto el
-- panel de admin siga funcionando. Dar de alta a otro admin es un UPDATE
-- deliberado:
--
--   UPDATE profiles SET is_admin = TRUE WHERE email = 'otro@ejemplo.com';
--
-- QUE HACER AL DESPLEGAR
-- ----------------------
-- El codigo que lee `profiles.is_admin` no puede desplegarse antes que esta
-- migration. Si corre primero, la columna no existe, el chequeo da `undefined`
-- (que en JS no es `true`) y TODOS los admins pierden el panel, incluido el
-- unico que hay hoy. Orden: migration primero, deploy despues.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: el admin que el hardcodeado designaba. `lower()` porque en
-- Postgres los emails de auth.users se guardan tal cual los escribio el
-- usuario y no siempre normalizados.
UPDATE profiles
   SET is_admin = TRUE
 WHERE lower(email) = lower('matias.pagano07@gmail.com')
   AND is_admin = FALSE;

COMMENT ON COLUMN profiles.is_admin IS
  'TRUE si el usuario tiene acceso al panel de admin y a /api/admin/*. Solo el backend (service_role) puede cambiarlo: ver el trigger profiles_admin_immutable.';

-- ========================================
-- 1. La columna no puede escribirse desde el cliente
-- ========================================
--
-- La policy "Users can update their own profile" de 034 es
--
--   FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (...)
--
-- que no restringe columnas: un usuario autenticado puede UPDATE de CUALQUIER
-- columna de SU PROPRIA fila usando la anon key. Sin este trigger, agregar
-- `is_admin` a profiles seria una escalada de privilegios trivial y de una
-- linea:
--
--   supabase.from('profiles').update({ is_admin: true }).eq('id', miId)
--
-- (El `WITH CHECK` de esa policy no ayuda: valida `id` y `tenant_id`, columnas
-- que el atacante no necesita cambiar.)
--
-- El patron es el mismo que ya usa `enforce_profile_tenant_immutability` en
-- 034 para `tenant_id`: un backstop a nivel motor, independiente de que la
-- policy este bien escrita.
CREATE OR REPLACE FUNCTION public.enforce_profile_admin_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'profiles.is_admin no puede modificarse desde el cliente'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_admin_immutable ON profiles;
CREATE TRIGGER profiles_admin_immutable
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profile_admin_immutability();

-- ========================================
-- 2. is_admin() lee la columna
-- ========================================
--
-- Misma firma y semantica que la version de 034, porque la usa la policy
-- "Admin can read analytics events" (034). Un admin deja de serlo en el
-- instante del UPDATE, sin necesidad de redeploy ni de cerrar sesion.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles
     WHERE public.profiles.id = auth.uid()
       AND public.profiles.is_admin
  );
$$;

-- Los mismos permisos que dejo 034, y por el mismo motivo: Supabase aplica
-- ALTER DEFAULT PRIVILEGES que otorga EXECUTE sobre funciones nuevas del
-- schema public a `anon` y `authenticated` con permiso DIRECTO, asi que
-- revocar solo de PUBLIC deja el ACL abierto. Ver el comentario de 036.
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
