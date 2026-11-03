-- ========================================
-- COLABORADORES — NIVEL 3
-- ========================================
-- Cierra cuatro huecos del modelo de acceso:
--
--  1. `tenant_users.status` permite DESACTIVAR a alguien sin borrar su
--     historial de membresías (el borrado definitivo sigue existiendo).
--  2. `invitations.expires_at` le pone vencimiento a una invitación; sin esto
--     un email viejo servía para entrar años después.
--  3. Un trigger impide degradar o desactivar al último owner activo de una
--     empresa: la empresa nunca queda sin propietario.
--  4. `transfer_tenant_ownership` hace la transferencia en una transacción:
--     primero promueve al nuevo owner y después degrada al anterior, que es el
--     orden que satisface el trigger del punto 3.
--
-- El modelo de permisos vive en `src/lib/roles.ts`; acá sólo se protege el
-- invariante de datos que ningún endpoint puede garantizar por sí solo.

-- ---------------------------------------------------------------
-- 1) Estado de la membresía
-- ---------------------------------------------------------------
ALTER TABLE tenant_users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE tenant_users DROP CONSTRAINT IF EXISTS tenant_users_status_check;
ALTER TABLE tenant_users
  ADD CONSTRAINT tenant_users_status_check
  CHECK (status IN ('active', 'inactive'));

CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_status
  ON tenant_users (tenant_id, status);

-- Las memberships viejas (y las nuevas) quedan activas mientras no se diga lo
-- contrario; el DEFAULT ya cubre las filas existentes.

-- ---------------------------------------------------------------
-- 2) Vencimiento de invitaciones
-- ---------------------------------------------------------------
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

UPDATE invitations
  SET expires_at = COALESCE(created_at, NOW()) + INTERVAL '7 days'
  WHERE expires_at IS NULL;

ALTER TABLE invitations
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '7 days');

ALTER TABLE invitations
  ALTER COLUMN expires_at SET NOT NULL;

-- La aceptación y el listado de pendientes buscan por email/tenant con
-- `accepted_at IS NULL`; el índice parcial evita escanear la tabla entera.
CREATE INDEX IF NOT EXISTS idx_invitations_pending_email
  ON invitations (email)
  WHERE accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invitations_pending_tenant
  ON invitations (tenant_id)
  WHERE accepted_at IS NULL;

-- ---------------------------------------------------------------
-- 3) Protección del último owner
-- ---------------------------------------------------------------
-- Sólo se dispara en UPDATE. El borrado en cascada de una empresa (borrado de
-- cuenta) elimina la fila padre `tenants` y sus `tenant_users`; proteger ese
-- camino con un BEFORE DELETE rompería el derecho de supresión. Las bajas de
-- owner desde la app, además, ya están bloqueadas en el servicio.
CREATE OR REPLACE FUNCTION protect_last_tenant_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.role = 'owner'
     AND OLD.status = 'active'
     AND (
       NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.role IS DISTINCT FROM 'owner'
       OR NEW.status IS DISTINCT FROM 'active'
     )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM tenant_users
      WHERE tenant_id = OLD.tenant_id
        AND role = 'owner'
        AND status = 'active'
        AND id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'last_owner_protected: la empresa no puede quedar sin propietario'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_last_tenant_owner_trigger ON tenant_users;
CREATE TRIGGER protect_last_tenant_owner_trigger
  BEFORE UPDATE ON tenant_users
  FOR EACH ROW
  EXECUTE FUNCTION protect_last_tenant_owner();

-- ---------------------------------------------------------------
-- 4) Transferencia de propiedad
-- ---------------------------------------------------------------
-- Debe correr como una sola transacción. El orden importa: se promueve al
-- nuevo owner ANTES de degradar al actual, porque el trigger del punto 3 no
-- deja que la empresa quede un instante sin owner.
CREATE OR REPLACE FUNCTION transfer_tenant_ownership(
  p_tenant_id UUID,
  p_new_owner UUID,
  p_actor UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role TEXT;
  v_target_role TEXT;
  v_target_status TEXT;
BEGIN
  IF p_actor = p_new_owner THEN
    RAISE EXCEPTION 'transfer_same_user' USING ERRCODE = 'check_violation';
  END IF;

  SELECT role INTO v_actor_role
  FROM tenant_users
  WHERE tenant_id = p_tenant_id
    AND user_id = p_actor
    AND status = 'active';

  IF v_actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'transfer_not_owner' USING ERRCODE = 'check_violation';
  END IF;

  SELECT role, status INTO v_target_role, v_target_status
  FROM tenant_users
  WHERE tenant_id = p_tenant_id
    AND user_id = p_new_owner;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'transfer_target_not_member' USING ERRCODE = 'check_violation';
  END IF;

  IF v_target_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'transfer_target_inactive' USING ERRCODE = 'check_violation';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'transfer_target_already_owner' USING ERRCODE = 'check_violation';
  END IF;

  -- 1. El nuevo owner.
  UPDATE tenant_users
    SET role = 'owner'
    WHERE tenant_id = p_tenant_id
      AND user_id = p_new_owner;

  -- 2. El anterior baja a manager: conserva acceso operativo y administrativo
  --    de la sucursal, pero deja de ser dueño. También se reactiva por si la
  --    fila venía inactiva (no debería, el chequeo de arriba la exige activa).
  UPDATE tenant_users
    SET role = 'manager', status = 'active'
    WHERE tenant_id = p_tenant_id
      AND user_id = p_actor
      AND role = 'owner';
END;
$$;

-- Sólo el service role (que es quien llama a la app) necesita ejecutarla.
REVOKE ALL ON FUNCTION transfer_tenant_ownership(UUID, UUID, UUID) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION transfer_tenant_ownership(UUID, UUID, UUID) TO service_role;
  END IF;
END $$;
