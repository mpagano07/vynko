-- ========================================
-- ADMIN ANALYTICS TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT NOT NULL CHECK (event_type IN ('signup', 'payment')),
  user_email TEXT,
  user_name TEXT,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast queries by event type and date
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events (event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events (created_at DESC);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Admin check function: returns true if the authenticated user is the platform admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE auth.users.id = auth.uid() AND auth.users.email = 'matias.pagano07@gmail.com'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Only admins can read analytics events
CREATE POLICY "Admin can read analytics events"
  ON analytics_events
  FOR SELECT
  USING (is_admin());

-- Any authenticated user can insert (for API routes that record events)
CREATE POLICY "Authenticated users can insert analytics events"
  ON analytics_events
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
