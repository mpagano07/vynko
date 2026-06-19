-- ========================================
-- INVITATIONS TABLE (Invitar colaboradores)
-- ========================================
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'manager', 'member')),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, email)
);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invitations'
      AND policyname = 'Users can view invitations for their tenant'
  ) THEN
    CREATE POLICY "Users can view invitations for their tenant" ON invitations
      FOR SELECT USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invitations'
      AND policyname = 'Only owners can insert invitations'
  ) THEN
    CREATE POLICY "Only owners can insert invitations" ON invitations
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM tenant_users
          WHERE tenant_id = invitations.tenant_id
            AND user_id = auth.uid()
            AND role = 'owner'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_tenant_id ON invitations(tenant_id);
