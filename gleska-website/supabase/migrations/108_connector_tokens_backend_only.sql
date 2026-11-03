-- Connector OAuth tokens become backend-only.
-- connector_tokens (created by the legacy gleska-backend-f/migrations/connectors_setup.sql) had a
-- FOR ALL policy letting an employer read and write their own rows with the public anon key, so a
-- browser session could read raw Google/Zoom/Slack/Meta access and refresh tokens. No web or
-- mobile code reads this table; only the backend does, with the service role (bypasses RLS).
--
-- RLS impact: drops the "Employers manage own connector tokens" policy and revokes all privileges
--   from anon and authenticated. RLS stays enabled with no client policy = no client access.
--   service_role is unaffected.
-- Data impact: none. No rows are read, changed or deleted. Tokens become encrypted at rest only as
--   they are next written by a backend with CONNECTOR_TOKEN_ENCRYPTION_KEY set.
-- Rollback: re-create the policy from connectors_setup.sql and
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.connector_tokens TO authenticated.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.connector_tokens') IS NOT NULL THEN
    ALTER TABLE public.connector_tokens ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Employers manage own connector tokens" ON public.connector_tokens;
    REVOKE ALL ON TABLE public.connector_tokens FROM anon, authenticated;
  END IF;
END
$$;

COMMIT;
