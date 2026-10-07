-- RECUPERACIÓN DE SUCURSALES BORRADAS (post-downgrade prematuro)
-- AVISO: Esto no recupera datos borrados (invitaciones/colaboradores). Solo recrea memberships de tenant_users para sucursales extra que fueron eliminadas.
-- 1) Obtener ramas que debería tener el owner (backup o listado conocido)
-- 2) Reemplazar REEMPLAZAR_ID_DEL_OWNER y TENANT_IDS_EXTRA
BEGIN;

-- Ejemplo: restaurar membership para sucursales extra
-- INSERT INTO tenant_users (tenant_id, user_id, role)
-- SELECT 'tenant_extra_1', 'REEMPLAZAR_ID_DEL_OWNER', 'owner' WHERE NOT EXISTS (SELECT 1 FROM tenant_users WHERE tenant_id='tenant_extra_1' AND user_id='REEMPLAZAR_ID_DEL_OWNER');
-- INSERT INTO tenant_users (tenant_id, user_id, role)
-- SELECT 'tenant_extra_2', 'REEMPLAZAR_ID_DEL_OWNER', 'owner' WHERE NOT EXISTS (SELECT 1 FROM tenant_users WHERE tenant_id='tenant_extra_2' AND user_id='REEMPLAZAR_ID_DEL_OWNER');

-- Restaurar estado de suscripción de esas ramas también
UPDATE tenants
SET subscription_plan = 'business', subscription_status = 'active'
WHERE id IN ('REEMPLAZAR_ID_TENANT_EXTRA_1','REEMPLAZAR_ID_TENANT_EXTRA_2')
  AND subscription_status IN ('canceled','free','inactive');

COMMIT;
