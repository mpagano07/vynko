-- REPARACIÓN: restaurar estado si quedó corrupto por el downgrade prematuro
-- 1. Ver diagnóstico primero. Ajustar tenant_id
BEGIN;
-- Si tiene pending (intento interrumpido), limpiar
UPDATE tenants
SET mercadopago_pending_preapproval_id = NULL,
    mercadopago_pending_plan = NULL
WHERE mercadopago_pending_preapproval_id IS NOT NULL;

-- Ejemplo de restauración para un tenant específico (business active)
-- UPDATE tenants
-- SET subscription_plan = 'business',
--     subscription_status = 'active',
--     subscription_current_period_end = NULL  -- o ajustar según fecha de pago
-- WHERE id = 'tenant_id_a_reparar';

-- Si quedó con status 'canceled' y plan 'starter' sin haber pagado el nuevo preapproval
-- restaurar a business/active (validar con diagnóstico)
-- Y si hay preapproval viejo colgado, limpiar pending y restaurar MP ID si corresponde

COMMIT;
