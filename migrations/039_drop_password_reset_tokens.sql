-- ============================================================
-- 039: Eliminar la tabla legacy `password_reset_tokens`
--
-- Creada por la migration 024 y usada por una version anterior del
-- recuperacion de contrasena, que guardaba el hash SHA-256 del token y mandaba
-- el link por email.
--
-- POR QUE SE PUEDE BORRAR
-- ----------------------
-- El recuperacion actual ya no la usa: `POST /api/auth/recover` canjea un codigo
-- PKCE contra Supabase (`exchangeCodeForSession`) y cambia la contrasena con
-- `updateUser`. Un `grep -r password_reset_tokens src/` no devuelve nada.
--
-- Ademas la tabla ya era inalcanzable desde el cliente: 034 le dejo RLS sin
-- policies y le revoco INSERT/UPDATE/DELETE a `anon` y `authenticated`. O sea
-- que no era un riesgo abierto, era codigo muerto que alguien mas podria
-- mantener por error creyendo que era el mecanismo vigente.
--
-- QUE PASA CON LOS DATOS
-- ----------------------
-- Se borran. A proposito:
--   - Los tokens tienen `expires_at` y son hashes, no credenciales en claro. Un
--     hash SHA-256 de un token que caduco no sirve para nada.
--   - La migration 024 ya habia borrado la columna `token` en claro ("Invalidate
--     legacy plaintext tokens"), o sea que la tabla nunca volvio a tener material
--     utilizable desde esa fecha.
--   - Dejarla inaccesible con REVOKE era la alternativa conservadora, pero deja
--     una tabla que parece viva. El riesgo de que alguien la reintroduzca creyendo
--     que es el camino de recuperacion vale mas que conservar hashes vencidos.
--
-- El script imprime cuantas filas habia antes de borrar, asi queda registrado en
-- el log de aplicacion.
--
-- ROLLBACK
-- --------
-- Recrear la tabla es suficiente; ningun codigo la lee, asi que no hay que
-- restaurar nada mas. Si hiciera falta auditing, el bloque siguiente la deja
-- como estaba en 024:
--
--   CREATE TABLE public.password_reset_tokens (
--     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--     email TEXT NOT NULL,
--     token_hash TEXT NOT NULL,
--     expires_at TIMESTAMPTZ NOT NULL,
--     created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
--   );
--   CREATE UNIQUE INDEX password_reset_tokens_token_hash_key
--     ON public.password_reset_tokens(token_hash);
--   ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
--
-- Los datos no se pueden recuperar: no hay backup en esta migration.
--
-- NOTA SOBRE RE-EJECUCION
-- -----------------------
-- 034 menciona la tabla en tres listas de tablas de negocio (policies de
-- service_role, RLS explicito y REVOKE). Correr las migrations en orden la deja
-- bien: 024 crea, 034 configura, 039 elimina. Pero VOLVER a correr 034 contra una
-- base ya migrada fallaria, porque `DROP POLICY ... ON public.password_reset_tokens`
-- da error si la tabla no existe. Es el comportamiento normal de estas migrations
-- y no afecta a un entorno que las aplica de a una.
-- ============================================================

DO $$
DECLARE
  v_rows BIGINT;
BEGIN
  IF to_regclass('public.password_reset_tokens') IS NULL THEN
    RAISE NOTICE '039: password_reset_tokens no existe; nada que hacer';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.password_reset_tokens' INTO v_rows;
  RAISE NOTICE '039: password_reset_tokens tiene % filas; se eliminan', v_rows;

  EXECUTE 'DROP TABLE IF EXISTS public.password_reset_tokens';
  RAISE NOTICE '039: tabla eliminada';
END $$;
