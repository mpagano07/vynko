-- ========================================
-- ROLES DE COLABORADOR — NIVEL 2
-- ========================================
-- Agrega los roles operativos que faltaban:
--   cashier (Cajero)   vende y opera la caja
--   stock   (Depósito) administra catálogo, stock, compras y transferencias
--   viewer  (Consulta) solo lectura
--
-- `tenant_users.role` e `invitations.role` tenían un CHECK que solo permitía
-- owner/manager/member; sin este cambio cualquier alta con un rol nuevo falla
-- en la base. El modelo de permisos vive en `src/lib/roles.ts`.

ALTER TABLE tenant_users DROP CONSTRAINT IF EXISTS tenant_users_role_check;
ALTER TABLE tenant_users
  ADD CONSTRAINT tenant_users_role_check
  CHECK (role IN ('owner', 'manager', 'cashier', 'stock', 'viewer', 'member'));

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE invitations
  ADD CONSTRAINT invitations_role_check
  CHECK (role IN ('owner', 'manager', 'cashier', 'stock', 'viewer', 'member'));
