
-- RECUPERACIÓN DE SUCURSALES BORRADAS (post-downgrade prematuro)
BEGIN;

-- Recrear/asegurar tenants de sucursales extra
INSERT INTO tenants (
  id,
  name,
  slug,
  subscription_plan,
  subscription_status,
  subscription_current_period_end
)
VALUES
  ('04c71cb4-0454-4bcc-8e5c-89cc6e779a69','Sucursal 04c71cb4','sucursal-04c71cb4','business','active',NULL),
  ('4a666997-26ea-421d-bd3f-1ff10f4dffe8','Sucursal 4a666997','sucursal-4a666997','business','active',NULL),
  ('8f3dab56-2668-489e-9242-7141fc2abac5','Sucursal 8f3dab56','sucursal-8f3dab56','business','active',NULL),
  ('b7bbb554-6fa5-4bee-b292-66888f21e1d2','Sucursal b7bbb554','sucursal-b7bbb554','business','active',NULL),
  ('bcee34c1-4a99-446b-b9b0-9b01e49b2511','Sucursal bcee34c1','sucursal-bcee34c1','business','active',NULL)
ON CONFLICT (id) DO UPDATE
SET subscription_plan='business', subscription_status='active';

-- Asegurar memberships (owner) - corregir user_id cuando se confirme
INSERT INTO tenant_users (tenant_id, user_id, role)
SELECT t.id::uuid, 'REEMPLAZAR_USER_ID_CORRECTO'::uuid, 'owner'
FROM (VALUES
  ('04c71cb4-0454-4bcc-8e5c-89cc6e779a69'),
  ('4a666997-26ea-421d-bd3f-1ff10f4dffe8'),
  ('8f3dab56-2668-489e-9242-7141fc2abac5'),
  ('b7bbb554-6fa5-4bee-b292-66888f21e1d2'),
  ('bcee34c1-4a99-446b-b9b0-9b01e49b2511')
) AS t(id)
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_users tu
  WHERE tu.tenant_id = t.id::uuid
    AND tu.user_id = 'REEMPLAZAR_USER_ID_CORRECTO'::uuid
);

COMMIT;

