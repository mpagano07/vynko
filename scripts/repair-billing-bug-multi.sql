-- REPARACIÓN MULTI-TENANT: restaurar TODAS las ramas del owner
-- 1) Ejecutar diag-billing-bug.sql para obtener user_id/email/owner y ver todas las ramas
-- 2) Reemplazar OWNER_USER_ID por el id del usuario owner
BEGIN;

-- Limpiar pendings globales si existen
UPDATE tenants
SET mercadopago_pending_preapproval_id = NULL,
    mercadopago_pending_plan = NULL
WHERE mercadopago_pending_preapproval_id IS NOT NULL;

-- Restaurar TODAS las ramas del owner a business/active
UPDATE tenants t
SET subscription_plan = 'business',
    subscription_status = 'active',
    mercadopago_pending_preapproval_id = NULL,
    mercadopago_pending_plan = NULL
FROM tenant_users tu
WHERE tu.tenant_id = t.id
  AND tu.user_id = 'OWNER_USER_ID'
  AND tu.role = 'owner'
  AND t.subscription_status IN ('canceled', 'free', 'inactive');

COMMIT;
