-- RECUPERACIÓN DE SUCURSALES BORRADAS (post-downgrade prematuro)
-- AVISO: Esto no recupera datos borrados (invitaciones/colaboradores). Solo recrea memberships de tenant_users para sucursales extra que fueron eliminadas.
-- 1) Obtener ramas que debería tener el owner (backup o listado conocido)
-- 2) Reemplazar a958da82-e8e7-4141-89c2-2c9ad92ea3e2 y TENANT_IDS_EXTRA
BEGIN;

-- Ejemplo: restaurar membership para sucursales extra
INSERT INTO tenant_users (tenant_id, user_id, role)
SELECT '04c71cb4-0454-4bcc-8e5c-89cc6e779a69', 'a958da82-e8e7-4141-89c2-2c9ad92ea3e2', 'owner' WHERE NOT EXISTS (SELECT 1 FROM tenant_users WHERE tenant_id='04c71cb4-0454-4bcc-8e5c-89cc6e779a69' AND user_id='a958da82-e8e7-4141-89c2-2c9ad92ea3e2');
INSERT INTO tenant_users (tenant_id, user_id, role)
SELECT 'f4210c70-3c52-4e90-b804-0bd4d3db645a', 'a958da82-e8e7-4141-89c2-2c9ad92ea3e2', 'owner' WHERE NOT EXISTS (SELECT 1 FROM tenant_users WHERE tenant_id='f4210c70-3c52-4e90-b804-0bd4d3db645a' AND user_id='a958da82-e8e7-4141-89c2-2c9ad92ea3e2');

-- Restaurar estado de suscripción de esas ramas también
UPDATE tenants
SET subscription_plan = 'business', subscription_status = 'active'
WHERE id IN ('04c71cb4-0454-4bcc-8e5c-89cc6e779a69','f4210c70-3c52-4e90-b804-0bd4d3db645a')
  AND subscription_status IN ('canceled','free','inactive');

COMMIT;
