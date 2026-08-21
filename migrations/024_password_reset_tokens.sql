-- ========================================
-- Password reset tokens
-- Tokens are stored as SHA-256 hashes; the raw token is only ever
-- included in the emailed reset link and never persisted.
-- RLS is enabled with no policies: only the service role can read/write.
-- Idempotent: also repairs a legacy plaintext table if it exists.
-- ========================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS id UUID;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS token_hash TEXT;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- Invalidate legacy plaintext tokens by dropping the old column
ALTER TABLE password_reset_tokens DROP COLUMN IF EXISTS token;

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_token_hash_key
  ON password_reset_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email
  ON password_reset_tokens(email);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires
  ON password_reset_tokens(expires_at);

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'password_reset_tokens' AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'password_reset_tokens must have RLS enabled';
  END IF;
END $$;
