-- RECUPERACIÓN DE SUCURSALES BORRADAS (post-downgrade prematuro)
-- AVISO: Esto no recupera datos borrados (invitaciones/colaboradores). Solo recrea memberships de tenant_users para sucursales extra que fueron eliminadas.
-- 1) Obtener ramas que debería tener el owner (backup o listado conocido)
-- 2) Reemplazar OWNER_USER_ID y TENANT_IDS_EXTRA
BEGIN;

-- Ejemplo: restaurar membership para sucursales extra
-- INSERT INTO tenant_users (tenant_id, user_id, role)
-- SELECT 'tenant_extra_1', 'OWNER_USER_ID', 'owner' WHERE NOT EXISTS (SELECT 1 FROM tenant_users WHERE tenant_id='tenant_extra_1' AND user_id='OWNER_USER_ID');
-- INSERT INTO tenant_users (tenant_id, user_id, role)
-- SELECT 'tenant_extra_2', 'OWNER_USER_ID', 'owner' WHERE NOT EXISTS (SELECT 1 FROM tenant_users WHERE tenant_id='tenant_extra_2' AND user_id='OWNER_USER_ID');

-- Restaurar estado de suscripción de esas ramas también
UPDATE tenants
SET subscription_plan = 'business', subscription_status = 'active'
WHERE id IN ('TENANT_EXTRA_1','TENANT_EXTRA_2')
  AND subscription_status IN ('canceled','free','inactive');

COMMIT;
