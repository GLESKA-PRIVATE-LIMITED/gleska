-- Verifies migration 112: accept_job_match no longer raises 42702
-- ("column reference \"worker_profile_id\" is ambiguous") and accepts a PENDING match.
-- Self-contained: seeds its own rows and a stub get_current_job_match_workers, so it runs on
-- a throwaway Postgres with migration 112 applied. Prints "ALL ACCEPT MATCH TESTS PASSED".
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.expect(ok BOOLEAN, label TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'FAILED: %', label; END IF; END $$;

DO $$
DECLARE
  v_emp uuid := '00000000-0000-0000-0000-00000000ee01';
  v_job uuid := '00000000-0000-0000-0000-00000000f001';
  v_wrk uuid := '00000000-0000-0000-0000-00000000ff01';
  v_status text;
  v_sqlstate text;
BEGIN
  DELETE FROM public.job_matches WHERE worker_profile_id = v_wrk;
  DELETE FROM public.individual_free_worker_claims WHERE employer_id = v_emp;
  DELETE FROM public.jobs WHERE id = v_job;
  DELETE FROM public.employer_profiles WHERE id = v_emp;

  INSERT INTO public.employer_profiles (id, employer_type) VALUES (v_emp, 'INDIVIDUAL');
  INSERT INTO public.jobs (id, employer_id, status, headcount_required)
    VALUES (v_job, v_emp, 'SEARCHING', 5);
  INSERT INTO public.job_matches (job_id, worker_profile_id, status, expires_at, composite_score)
    VALUES (v_job, v_wrk, 'PENDING', NOW() + INTERVAL '1 hour', 0.9);

  -- The call that raised 42702 before migration 112 must now succeed.
  BEGIN
    SELECT a.match_status INTO v_status
    FROM public.accept_job_match(v_emp, v_job, v_wrk) AS a;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    PERFORM pg_temp.expect(FALSE, 'accept_job_match raised ' || v_sqlstate ||
      ' (42702 = the worker_profile_id ambiguity bug)');
  END;

  PERFORM pg_temp.expect(v_status = 'ACCEPTED', 'accept returns ACCEPTED, got ' || coalesce(v_status, 'NULL'));
  PERFORM pg_temp.expect(
    EXISTS (SELECT 1 FROM public.job_matches WHERE worker_profile_id = v_wrk AND status = 'ACCEPTED'),
    'match row flipped to ACCEPTED');
END $$;

SELECT 'ALL ACCEPT MATCH TESTS PASSED';
