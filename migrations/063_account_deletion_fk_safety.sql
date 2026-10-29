-- ============================================================
-- 063: FKs a auth.users compatibles con el borrado de cuenta
-- ============================================================
--
-- Varias tablas de negocio guardan `created_by`/`opened_by`/`closed_by` con
-- `NOT NULL REFERENCES auth.users(id)` y sin acción de borrado. Al eliminar la
-- cuenta, PostgreSQL rechaza el DELETE del auth.user porque esos registros
-- todavía existen. El autoservicio (LEG-7) fallaba con un 500 después de haber
-- borrado ya las empresas del titular.
--
-- Esos registros no son del usuario: son de la empresa. Si la empresa sigue
-- existiendo (por ejemplo, el usuario era colaborador o transferió la rama),
-- el dato debe sobrevivir sin atribución personal. Por eso las columnas pasan a
-- ser nullable y la FK a `ON DELETE SET NULL`.
--
-- No se tocan `tenant_users.user_id`, `profiles.id`, `notifications.user_id`,
-- `activity_logs.user_id`, `invitations.invited_by` ni
-- `google_drive_tokens.user_id`: esas filas son del usuario y ya cascadean.
-- `sales.sold_by` y `webhook_events.user_id` ya estaban en SET NULL.

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT
      con.conname,
      rel.relname AS table_name,
      att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY (con.conkey)
    JOIN pg_class frel ON frel.oid = con.confrelid
    JOIN pg_namespace fnsp ON fnsp.oid = frel.relnamespace
    WHERE con.contype = 'f'
      AND nsp.nspname = 'public'
      AND fnsp.nspname = 'auth'
      AND frel.relname = 'users'
      AND att.attname IN ('created_by', 'opened_by', 'closed_by')
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT %I',
      fk.table_name,
      fk.conname
    );

    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL',
      fk.table_name,
      fk.column_name
    );

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE SET NULL',
      fk.table_name,
      fk.conname,
      fk.column_name
    );
  END LOOP;
END $$;

COMMENT ON COLUMN public.sales.created_by IS
  'Usuario que creó la venta. NULL si la cuenta fue eliminada; la venta pertenece a la empresa.';
COMMENT ON COLUMN public.stock_history.created_by IS
  'Usuario que registró el movimiento. NULL si la cuenta fue eliminada.';
COMMENT ON COLUMN public.cash_register_sessions.opened_by IS
  'Usuario que abrió la caja. NULL si la cuenta fue eliminada.';
