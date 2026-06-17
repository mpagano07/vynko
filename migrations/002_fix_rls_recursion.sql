-- ========================================
-- Fix RLS Policies (drop & recreate cleanly)
-- ========================================
-- The tenant_users policy was recursive causing 500 errors.
-- Profiles policies may have been duplicated/corrupted.
-- This drops all policies and recreates them cleanly.

-- Drop ALL existing policies
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view tenant members" ON tenant_users;
DROP POLICY IF EXISTS "Users can insert their own tenant membership" ON tenant_users;
DROP POLICY IF EXISTS "Users can view their own tenant data" ON tenants;
DROP POLICY IF EXISTS "Users can insert tenants" ON tenants;

-- ========================================
-- PROFILES
-- ========================================

CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Users can insert their own profile" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- ========================================
-- TENANT_USERS (non-recursive)
-- ========================================

CREATE POLICY "Users can view tenant members" ON tenant_users
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own tenant membership" ON tenant_users
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ========================================
-- TENANTS
-- ========================================

CREATE POLICY "Users can view their own tenant data" ON tenants
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM tenant_users WHERE tenant_id = tenants.id AND user_id = auth.uid())
  );

CREATE POLICY "Users can insert tenants" ON tenants
  FOR INSERT WITH CHECK (true);
