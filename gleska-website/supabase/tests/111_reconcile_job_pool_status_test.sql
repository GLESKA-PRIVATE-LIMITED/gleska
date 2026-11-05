-- Verifies migration 111: reconcile_job_candidate_pool no longer raises 42702
-- ("column reference \"status\" is ambiguous") and returns status = 'SUCCEEDED'.
-- Run against a schema that already has 110 (full unique index) + 111 applied, with the
-- stub PostGIS helpers below standing in for the real geometry functions.
-- Prints "ALL RECONCILE STATUS TESTS PASSED"; any failure raises.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.expect(ok BOOLEAN, label TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'FAILED: %', label; END IF; END $$;

DO $$
DECLARE
  v_job uuid := '00000000-0000-0000-0000-0000000f0001';
  v_site uuid := '00000000-0000-0000-0000-0000000f00a1';
  v_worker uuid := '00000000-0000-0000-0000-0000000f00b1';
  v_status text;
  v_sqlstate text;
BEGIN
  -- Seed one SEARCHING job and one eligible, freshly-located worker.
  INSERT INTO public.job_sites (id, location) VALUES (v_site, ST_SetSRID(ST_MakePoint(78.4, 17.3), 4326));
  INSERT INTO public.jobs (id, status, job_site_id, trade_id, headcount_required, required_skills)
    VALUES (v_job, 'SEARCHING', v_site, 'electrician', 5, '{}'::text[]);
  INSERT INTO public.worker_profiles (id, trade_id, skills, experience_years, expected_daily_wage,
      availability_status, profile_completed, latitude, longitude)
    VALUES (v_worker, 'electrician', '{house wiring}'::text[], 5, 650, 'AVAILABLE', TRUE, 17.3, 78.4);
  INSERT INTO public.worker_current_locations (worker_profile_id, accuracy_m, updated_at, latitude, longitude)
    VALUES (v_worker, 50, NOW(), 17.3, 78.4);

  -- The call that raised 42702 before migration 111 must now succeed.
  BEGIN
    SELECT r.status INTO v_status
    FROM public.reconcile_job_candidate_pool(v_job, 'JOB_CREATED') AS r;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    PERFORM pg_temp.expect(FALSE, 'reconcile raised ' || v_sqlstate || ' (42702 = the status ambiguity bug)');
  END;

  PERFORM pg_temp.expect(v_status = 'SUCCEEDED', 'reconcile returns SUCCEEDED, got ' || coalesce(v_status, 'NULL'));
  PERFORM pg_temp.expect(
    EXISTS (SELECT 1 FROM public.job_matches WHERE job_id = v_job AND worker_profile_id = v_worker AND status = 'PENDING'),
    'eligible worker was inserted into the candidate pool as PENDING');
END $$;

SELECT 'ALL RECONCILE STATUS TESTS PASSED';
