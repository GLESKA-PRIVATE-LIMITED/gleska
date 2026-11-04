-- Assertion tests for migration 109 (lock down PostGIS public.spatial_ref_sys).
-- Run on a database where PostGIS is installed and migration 109 has been applied by a role
-- that OWNS spatial_ref_sys (the success path). On Supabase where the table is owned by
-- supabase_admin, 109 commits with a WARNING instead — see the migration header — and this test
-- is not applicable until the owner enables RLS.
-- Prints "ALL SPATIAL_REF_SYS TESTS PASSED"; any failed check raises.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.expect(ok BOOLEAN, label TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'FAILED: %', label; END IF; END $$;

-- The table exists (PostGIS present).
SELECT pg_temp.expect(
  to_regclass('public.spatial_ref_sys') IS NOT NULL,
  'spatial_ref_sys exists (PostGIS installed)');

-- The browser-facing API roles can no longer touch the table.
SELECT pg_temp.expect(
  NOT has_table_privilege('anon', 'public.spatial_ref_sys', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.spatial_ref_sys', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.spatial_ref_sys', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.spatial_ref_sys', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.spatial_ref_sys', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.spatial_ref_sys', 'DELETE'),
  'anon and authenticated have no privileges on spatial_ref_sys');

-- RLS is enabled (success path; satisfies the Supabase advisor).
SELECT pg_temp.expect(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.spatial_ref_sys'::regclass),
  'RLS enabled on spatial_ref_sys');

SELECT 'ALL SPATIAL_REF_SYS TESTS PASSED';
