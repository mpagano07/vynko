-- ========================================
-- SCRIPT: Borrar usuario de prueba y datos asociados
-- ========================================
-- Ejecutar con service_role key (bypass RLS)

-- 1. PREVISUALIZACIÓN: Ver qué se va a borrar
SELECT
  u.email,
  u.id as user_id,
  t.id as tenant_id,
  t.name as tenant_name,
  (SELECT COUNT(*) FROM tenant_users tu2 WHERE tu2.tenant_id = t.id) as member_count,
  CASE
    WHEN (SELECT COUNT(*) FROM tenant_users tu2 WHERE tu2.tenant_id = t.id) <= 1
    THEN 'SERA BORRADO (huérfano)'
    ELSE 'SE MANTIENE (tiene otros miembros)'
  END as destino_tenant
FROM auth.users u
JOIN tenant_users tu ON tu.user_id = u.id
JOIN tenants t ON t.id = tu.tenant_id
WHERE u.email = 'matiaspagano@abc.gob.ar';

-- Ver eventos en analytics que quedarían huérfanos
SELECT event_type, user_email, user_name, tenant_id, created_at
FROM analytics_events
WHERE user_email = 'matiaspagano@abc.gob.ar'
   OR tenant_id IN (
     SELECT tu.tenant_id FROM tenant_users tu
     WHERE tu.user_id = (SELECT id FROM auth.users WHERE email = 'matiaspagano@abc.gob.ar')
   );

-- 2. BORRADO: Descomentar y ejecutar después de verificar
/*
-- Borrar eventos de analytics del usuario
DELETE FROM analytics_events
WHERE user_email = 'matiaspagano@abc.gob.ar'
   OR tenant_id IN (
     SELECT tu.tenant_id FROM tenant_users tu
     WHERE tu.user_id = (SELECT id FROM auth.users WHERE email = 'matiaspagano@abc.gob.ar')
   );

-- Borrar tenants donde el usuario es el único miembro
DELETE FROM tenants
WHERE id IN (
  SELECT tu.tenant_id
  FROM tenant_users tu
  WHERE tu.user_id = (SELECT id FROM auth.users WHERE email = 'matiaspagano@abc.gob.ar')
  GROUP BY tu.tenant_id
  HAVING COUNT(*) <= 1
);

-- Borrar el usuario (cascade: profiles, tenant_users, invitations, activity_logs, notifications)
DELETE FROM auth.users
WHERE email = 'matiaspagano@abc.gob.ar';

-- Verificación
SELECT COUNT(*) as analytics_restantes FROM analytics_events WHERE user_email = 'matiaspagano@abc.gob.ar';
SELECT COUNT(*) as usuarios_restantes FROM auth.users WHERE email = 'matiaspagano@abc.gob.ar';
*/