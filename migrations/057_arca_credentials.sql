-- ========================================
-- ARCA (ex-AFIP) Credentials and Configuration
-- ========================================

CREATE TABLE IF NOT EXISTS tenant_arca_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  cuit TEXT NOT NULL,
  punto_venta INT NOT NULL DEFAULT 1,
  environment TEXT NOT NULL DEFAULT 'homologacion'
    CHECK (environment IN ('homologacion', 'produccion')),
  concept INT NOT NULL DEFAULT 1
    CHECK (concept IN (1, 2, 3)),
  cert_pem TEXT,
  key_encrypted TEXT,
  key_iv TEXT,
  key_tag TEXT,
  wsaa_token TEXT,
  wsaa_sign TEXT,
  wsaa_expiration TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT false,
  last_tested_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenant_arca_config_tenant_id ON tenant_arca_config(tenant_id);

-- ========================================
-- RLS
-- ========================================
-- Deny-all (mismo patrón que feature_flags 055, rate_limit_buckets 036 y
-- sale_idempotency_keys 048): esta tabla guarda la clave privada cifrada y el
-- Token/Sign de WSAA (credenciales vivas por 12 h). Se accede SIEMPRE por
-- service role desde `src/lib/arca-service.ts`; PostgREST con la anon key no
-- debe poder leerla ni escribirla.
ALTER TABLE tenant_arca_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tenant_arca_config FROM anon, authenticated;

-- Limpieza idempotente: si una versión previa de esta migración creó policies
-- permisivas, se eliminan para que la tabla quede en deny-all.
DROP POLICY IF EXISTS "Users can view their tenant arca config" ON tenant_arca_config;
DROP POLICY IF EXISTS "Users can insert arca config in their tenant" ON tenant_arca_config;
DROP POLICY IF EXISTS "Users can update arca config in their tenant" ON tenant_arca_config;
DROP POLICY IF EXISTS "Users can delete arca config in their tenant" ON tenant_arca_config;
