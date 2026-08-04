-- ========================================
-- Security Fix: Restrict Tenants & Tenant Users RLS Ingestion
-- Migration: 020_fix_rls_security.sql
-- ========================================

-- 1. Drop vulnerable insert policies that allowed public/anon insertion
DROP POLICY IF EXISTS "Users can insert tenants" ON tenants;
DROP POLICY IF EXISTS "Users can insert their own tenant membership" ON tenant_users;

-- 2. Ensure SELECT policies remain clean and non-recursive
DROP POLICY IF EXISTS "Users can view tenant members" ON tenant_users;
CREATE POLICY "Users can view tenant members" ON tenant_users
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view their own tenant data" ON tenants;
CREATE POLICY "Users can view their own tenant data" ON tenants
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM tenant_users WHERE tenant_id = tenants.id AND user_id = auth.uid())
  );

-- Note: Inserter operations on tenants and tenant_users are handled strictly 
-- by server-side API routes (onboarding, accept-invite) via service_role (supabaseAdmin).
