-- Migration 031: Security sessions and activity log
-- Tracks per-device sessions and security audit events for the Security page.
-- Uses the same RLS pattern established in migrations 001-030.
-- NO passwords, tokens, or auth secrets are stored here.

BEGIN;

-- =====================================================================
-- TABLE: user_sessions
-- Records one row per browser/device session for each authenticated user.
-- session_key is a client-generated UUID stored in localStorage —
-- it is NOT the Supabase access_token or refresh_token.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_key   TEXT        NOT NULL,           -- opaque random UUID from localStorage
  device_name   TEXT,                           -- e.g. "Chrome on Windows"
  browser       TEXT,                           -- e.g. "Chrome 124"
  os            TEXT,                           -- e.g. "Windows 11"
  ip_address    TEXT,                           -- approximate public IP (not stored as sensitive)
  city          TEXT,                           -- approximate city from public IP lookup
  country       TEXT,                           -- approximate country
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_revoked    BOOLEAN     NOT NULL DEFAULT FALSE,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One session_key per user; prevents duplicate rows on repeated registrations
  CONSTRAINT user_sessions_user_session_key_unique UNIQUE (user_id, session_key)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
  ON public.user_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
  ON public.user_sessions (user_id, is_revoked, last_active DESC);

CREATE INDEX IF NOT EXISTS idx_user_sessions_session_key
  ON public.user_sessions (session_key);

-- updated_at trigger (reuses the existing trigger function from migration 001)
DROP TRIGGER IF EXISTS update_user_sessions_updated_at ON public.user_sessions;
CREATE TRIGGER update_user_sessions_updated_at
  BEFORE UPDATE ON public.user_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies — users can only see/modify their own session rows
DROP POLICY IF EXISTS "Users can view their own sessions" ON public.user_sessions;
CREATE POLICY "Users can view their own sessions"
  ON public.user_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own sessions" ON public.user_sessions;
CREATE POLICY "Users can insert their own sessions"
  ON public.user_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own sessions" ON public.user_sessions;
CREATE POLICY "Users can update their own sessions"
  ON public.user_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own sessions" ON public.user_sessions;
CREATE POLICY "Users can delete their own sessions"
  ON public.user_sessions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role bypass (for backend use)
DROP POLICY IF EXISTS "Service role can do anything on user_sessions" ON public.user_sessions;
CREATE POLICY "Service role can do anything on user_sessions"
  ON public.user_sessions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =====================================================================
-- TABLE: security_activity
-- Append-only audit log of important security events per user.
-- Events: 'login', 'logout', 'session_revoked', 'password_changed'
-- NO passwords, tokens, or secrets are stored in this table.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.security_activity (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type   TEXT        NOT NULL,    -- 'login' | 'logout' | 'session_revoked' | 'password_changed'
  description  TEXT,                   -- human-readable summary
  device_name  TEXT,                   -- device context at time of event
  browser      TEXT,
  os           TEXT,
  city         TEXT,
  country      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for user activity feed (newest first)
CREATE INDEX IF NOT EXISTS idx_security_activity_user_id
  ON public.security_activity (user_id);

CREATE INDEX IF NOT EXISTS idx_security_activity_user_created
  ON public.security_activity (user_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.security_activity ENABLE ROW LEVEL SECURITY;

-- RLS Policies — users can only see/insert their own activity rows
-- (No UPDATE or DELETE — this is an immutable audit log from the user's perspective)
DROP POLICY IF EXISTS "Users can view their own security activity" ON public.security_activity;
CREATE POLICY "Users can view their own security activity"
  ON public.security_activity FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own security activity" ON public.security_activity;
CREATE POLICY "Users can insert their own security activity"
  ON public.security_activity FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Service role bypass (for backend use)
DROP POLICY IF EXISTS "Service role can do anything on security_activity" ON public.security_activity;
CREATE POLICY "Service role can do anything on security_activity"
  ON public.security_activity FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMIT;
