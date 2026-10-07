-- DIAGNÓSTICO: estado de tenant que muestra 'período de prueba finalizó' tras back sin pagar
-- Reemplazar email por el del usuario afectado
SELECT id, name, created_at, subscription_plan, subscription_status,
       mercadopago_preapproval_id, mercadopago_pending_preapproval_id, mercadopago_pending_plan,
       subscription_current_period_end
FROM tenants
WHERE id IN (
  SELECT tenant_id FROM tenant_users WHERE user_id IN (
    SELECT id FROM auth.users WHERE email = 'REEMPLAZAR_EMAIL_DEL_USUARIO_AFECTADO' -- CAMBIAR
  )
) OR id IN (
  SELECT t.id FROM tenants t
  JOIN tenant_users tu ON tu.tenant_id = t.id
  JOIN auth.users u ON u.id = tu.user_id
  WHERE u.email = 'REEMPLAZAR_EMAIL_DEL_USUARIO_AFECTADO' -- CAMBIAR
)
ORDER BY id;
