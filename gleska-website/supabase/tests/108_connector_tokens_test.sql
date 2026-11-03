-- Assertion tests for migration 108 (connector_tokens backend-only).
-- Needs the stand-ins from supabase/CLAUDE.md, an employer_profiles row
-- aaaaaaaa-…-0001 owned by user 11111111-…-1111, and connector_tokens created by
-- gleska-backend-f/migrations/connectors_setup.sql BEFORE 108 is applied.
-- Prints "ALL CONNECTOR TOKEN TESTS PASSED"; any failed check raises.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.expect(ok BOOLEAN, label TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'FAILED: %', label; END IF; END $$;

INSERT INTO public.connector_tokens (employer_id, provider, access_token, refresh_token)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'gmail', 'secret-access', 'secret-refresh')
ON CONFLICT (employer_id, provider) DO NOTHING;

SELECT pg_temp.expect(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'connector_tokens'),
  'no client policy remains on connector_tokens');
SELECT pg_temp.expect(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.connector_tokens'::regclass),
  'RLS still enabled');
SELECT pg_temp.expect(
  NOT has_table_privilege('authenticated', 'public.connector_tokens', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.connector_tokens', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.connector_tokens', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.connector_tokens', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.connector_tokens', 'SELECT'),
  'anon and authenticated have no table privileges');

-- The owning employer's own session can no longer read the raw tokens.
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
DO $$
BEGIN
  PERFORM access_token FROM public.connector_tokens;
  RAISE EXCEPTION 'FAILED: authenticated could read connector_tokens';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;
RESET ROLE;

-- The backend (service_role) still reads and writes.
SET ROLE service_role;
SELECT pg_temp.expect(
  (SELECT count(*) FROM public.connector_tokens WHERE provider = 'gmail') = 1,
  'service_role can read tokens');
UPDATE public.connector_tokens SET status = 'expired' WHERE provider = 'gmail';
RESET ROLE;

SELECT 'ALL CONNECTOR TOKEN TESTS PASSED';
