
-- RECUPERACIÓN DE SUCURSALES BORRADAS (post-downgrade prematuro)
-- AVISO: Esto recrea tenants faltantes y memberships para sucursales extra.
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
  (
    '04c71cb4-0454-4bcc-8e5c-89cc6e779a69',
    'Sucursal 04c71cb4',
    'sucursal-04c71cb4',
    'business',
    'active',
    NULL
  ),
  (
    'f4210c70-3c52-4e90-b804-0bd4d3db645a',
    'Sucursal f4210c70',
    'sucursal-f4210c70',
    'business',
    'active',
    NULL
  )
ON CONFLICT (id) DO UPDATE
SET
  subscription_plan = 'business',
  subscription_status = 'active';

-- Asegurar memberships (owner)
INSERT INTO tenant_users (tenant_id, user_id, role)
SELECT t.id::uuid, 'a958da82-e8e7-4141-89c2-2c9ad92ea3e2'::uuid, 'owner'
FROM (VALUES
  ('04c71cb4-0454-4bcc-8e5c-89cc6e779a69'),
  ('f4210c70-3c52-4e90-b804-0bd4d3db645a')
) AS t(id)
WHERE NOT EXISTS (
  SELECT 1
  FROM tenant_users tu
  WHERE tu.tenant_id = t.id::uuid
    AND tu.user_id = 'a958da82-e8e7-4141-89c2-2c9ad92ea3e2'::uuid
);

COMMIT;

