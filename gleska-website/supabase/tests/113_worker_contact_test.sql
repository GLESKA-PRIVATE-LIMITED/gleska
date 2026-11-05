-- Verifies migration 113: get_worker_contact_secure exists and is NOT callable by the API
-- roles (anon/authenticated), so worker phone/email can never be read from the browser.
-- Run after 113 is applied (roles anon/authenticated must exist, as they do on Supabase).
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.expect(ok BOOLEAN, label TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'FAILED: %', label; END IF; END $$;

SELECT pg_temp.expect(
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_worker_contact_secure'
      AND p.prosecdef  -- SECURITY DEFINER
  ),
  'get_worker_contact_secure exists and is SECURITY DEFINER');

SELECT pg_temp.expect(
  NOT has_function_privilege('anon', 'public.get_worker_contact_secure(uuid)', 'EXECUTE'),
  'anon cannot EXECUTE get_worker_contact_secure');

SELECT pg_temp.expect(
  NOT has_function_privilege('authenticated', 'public.get_worker_contact_secure(uuid)', 'EXECUTE'),
  'authenticated cannot EXECUTE get_worker_contact_secure');

SELECT 'ALL WORKER CONTACT TESTS PASSED';
