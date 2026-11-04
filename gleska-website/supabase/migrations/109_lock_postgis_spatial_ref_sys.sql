-- 109_lock_postgis_spatial_ref_sys.sql
--
-- Supabase Security Advisor (CRITICAL): rls_disabled_in_public on public.spatial_ref_sys.
-- spatial_ref_sys is a reference table created by the PostGIS extension in the public schema.
-- Because RLS is disabled there, the anon/authenticated API roles can reach it through PostgREST.
--
-- Fix: remove anon/authenticated access to the table, and (where ownership allows) enable RLS so
-- the advisor's RLS check is satisfied. On hosted Supabase the table is usually owned by
-- supabase_admin, so ALTER TABLE ... ENABLE ROW LEVEL SECURITY may fail with "must be owner"
-- (insufficient_privilege). That case is caught and skipped; the REVOKE still removes the exposure.
-- If the advisor still reports the table afterwards, ask Supabase support to run the ENABLE RLS as
-- supabase_admin (the table cannot be relocated out of public without breaking PostGIS references).
--
-- Why this is safe for this project (no app behaviour changes):
--   * Distance matching uses ST_DistanceSphere(ST_SetSRID(ST_MakePoint(lng,lat),4326), geometry).
--     None of ST_MakePoint / ST_SetSRID / ST_DistanceSphere consult spatial_ref_sys.
--   * There is no ST_Transform and no ::geography cast anywhere in the schema.
--   * All matching runs inside SECURITY DEFINER functions (executed as the owner), and the backend
--     uses the service_role, which bypasses RLS. So neither path reads spatial_ref_sys as
--     anon/authenticated, and removing their access breaks nothing.
--
-- RLS impact: enables RLS on public.spatial_ref_sys where ownership permits (no policies added, so
--   the API roles get no access); otherwise RLS is left unchanged and access is removed via REVOKE.
-- Data impact: none. Only privileges change; no rows are read, inserted, updated or deleted.
-- Rollback: GRANT SELECT ON public.spatial_ref_sys TO anon, authenticated;
--   (and, if it was enabled here, ALTER TABLE public.spatial_ref_sys DISABLE ROW LEVEL SECURITY;)

BEGIN;

DO $$
DECLARE
  rls_done boolean := false;
  revoke_done boolean := false;
BEGIN
  IF to_regclass('public.spatial_ref_sys') IS NULL THEN
    RAISE NOTICE 'public.spatial_ref_sys not found (PostGIS not installed); nothing to do.';
    RETURN;
  END IF;

  -- Preferred: enable RLS. With no policies the anon/authenticated roles get no access, while
  -- service_role (BYPASSRLS) and the SECURITY DEFINER matching functions are unaffected.
  BEGIN
    ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;
    rls_done := true;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'Could not ENABLE RLS on spatial_ref_sys (owned by another role, e.g. supabase_admin).';
  END;

  -- Remove the browser-facing API roles' access to the table. Also wrapped, because on a
  -- supabase_admin-owned table the migration role may lack privilege to revoke.
  BEGIN
    REVOKE ALL ON TABLE public.spatial_ref_sys FROM anon, authenticated;
    revoke_done := true;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'Could not REVOKE anon/authenticated access on spatial_ref_sys (insufficient privilege).';
  END;

  IF rls_done OR revoke_done THEN
    RAISE NOTICE 'spatial_ref_sys locked down (rls_enabled=%, api_access_revoked=%).', rls_done, revoke_done;
  ELSE
    RAISE WARNING 'spatial_ref_sys could NOT be locked down from this role. The table is owned by a more privileged role. Run "ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;" as the owner (supabase_admin) — via Supabase support — to clear the advisor.';
  END IF;
END $$;

COMMIT;
