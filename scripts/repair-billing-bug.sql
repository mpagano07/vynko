-- REPARACIÓN: restaurar estado si quedó corrupto por el downgrade prematuro
-- Ejecutar después de diag-billing-bug.sql para obtener el tenant_id
BEGIN;
-- Limpiar todos los pendings si existen
UPDATE tenants
SET mercadopago_pending_preapproval_id = NULL,
    mercadopago_pending_plan = NULL
WHERE mercadopago_pending_preapproval_id IS NOT NULL;

-- Restauración específica: reemplazar REEMPLAZAR_ID_DEL_TENANT_A_RESTAURAR por el obtenido en el diagnóstico
-- Ejemplo: tenant con plan starter/canceled tras back sin pagar y con business original
UPDATE tenants
SET subscription_plan = 'business',
    subscription_status = 'active',
    mercadopago_pending_preapproval_id = NULL,
    mercadopago_pending_plan = NULL
WHERE id = 'REEMPLAZAR_ID_DEL_TENANT_A_RESTAURAR'
  AND subscription_status IN ('canceled', 'free', 'inactive');

COMMIT;
