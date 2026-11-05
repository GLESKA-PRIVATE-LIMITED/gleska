-- 112_accept_job_match_worker_id_ambiguity.sql
--
-- Bug: clicking "Select Worker" calls accept_job_match (last defined in migration 063). In
-- production it failed with SQLSTATE 42702 "column reference \"worker_profile_id\" is
-- ambiguous"; the backend surfaces that as HTTP 422 with the raw error (browser shows
-- "code:42702"), so no candidate could be hired. Reproduced from Render logs 2026-11-05 and
-- locally against the real 063 body. (It only surfaced now that matching finally produces
-- PENDING candidates for Select Worker to act on — migrations 110 + 111.)
--
-- Why: accept_job_match is declared RETURNS TABLE (..., worker_profile_id UUID, ...). In
-- PL/pgSQL every RETURNS TABLE column is also an implicit variable, so `worker_profile_id`
-- exists as a variable in the body. Two statements referenced the job_matches /
-- individual_free_worker_claims column `worker_profile_id` WITHOUT a table qualifier, so each
-- was ambiguous between the column and the output variable -> 42702:
--   * SELECT ... INTO selected_match FROM public.job_matches WHERE ... worker_profile_id = ...
--   * NOT EXISTS (... FROM public.individual_free_worker_claims WHERE ... worker_profile_id = ...)
-- The sibling function reject_job_match (068) already qualifies every column, so it is fine;
-- only accept_job_match needed the fix.
--
-- Fix: qualify those two statements with table aliases so `worker_profile_id` unambiguously
-- means the column. Pure CREATE OR REPLACE; every other line is byte-for-byte identical to
-- migration 063, so no behaviour (entitlements, free-worker/commission gating, headcount,
-- job-fill) changes.
--
-- RLS impact: none (SECURITY DEFINER, search_path pinned to public, as before).
-- Data impact: none — only name resolution is disambiguated.
-- Rollback: re-apply migration 063's definition of accept_job_match.

BEGIN;

CREATE OR REPLACE FUNCTION public.accept_job_match(
  p_employer_id UUID,
  p_job_id UUID,
  p_worker_profile_id UUID
)
RETURNS TABLE (
  match_id UUID,
  worker_profile_id UUID,
  match_status TEXT,
  job_status TEXT,
  accepted_count INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  selected_employer public.employer_profiles%ROWTYPE;
  selected_job public.jobs%ROWTYPE;
  selected_match public.job_matches%ROWTYPE;
  accepted_workers INTEGER;
  free_workers_used INTEGER;
  resulting_job_status TEXT;
  has_paid_commission BOOLEAN;
BEGIN
  SELECT * INTO selected_employer
  FROM public.employer_profiles
  WHERE id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYER_NOT_FOUND'; END IF;

  SELECT * INTO selected_job
  FROM public.jobs
  WHERE id = p_job_id AND employer_id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND'; END IF;
  IF selected_job.status <> 'SEARCHING' THEN RAISE EXCEPTION 'JOB_NOT_OPEN_FOR_HIRING'; END IF;

  SELECT * INTO selected_match
  FROM public.job_matches AS jm
  WHERE jm.job_id = p_job_id AND jm.worker_profile_id = p_worker_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_NOT_FOUND'; END IF;
  IF selected_match.status <> 'PENDING' THEN RAISE EXCEPTION 'MATCH_NOT_PENDING'; END IF;
  IF selected_match.expires_at <= NOW() THEN RAISE EXCEPTION 'MATCH_EXPIRED'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_current_job_match_workers(p_employer_id, p_job_id) current_match
    WHERE current_match.worker_profile_id = p_worker_profile_id
      AND current_match.status = 'PENDING'
  ) THEN
    RAISE EXCEPTION 'WORKER_NOT_ELIGIBLE';
  END IF;

  IF selected_employer.employer_type IN ('REGISTERED_INDUSTRY', 'REGISTERED_BUSINESS', 'UNREGISTERED_BUSINESS') THEN
    IF COALESCE(selected_employer.subscription_valid_until > NOW(), FALSE) = FALSE
      AND COALESCE(selected_employer.trial_ends_at > NOW(), FALSE) = FALSE THEN
      RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED';
    END IF;
  END IF;

  SELECT COUNT(*)::INTEGER INTO accepted_workers
  FROM public.job_matches
  WHERE job_id = p_job_id AND status = 'ACCEPTED';
  IF accepted_workers >= selected_job.headcount_required THEN RAISE EXCEPTION 'HEADCOUNT_FILLED'; END IF;

  IF selected_employer.employer_type = 'INDIVIDUAL'
    AND NOT EXISTS (
      SELECT 1 FROM public.individual_free_worker_claims AS claim
      WHERE claim.employer_id = p_employer_id AND claim.worker_profile_id = p_worker_profile_id
    ) THEN
    SELECT COUNT(*)::INTEGER INTO free_workers_used
    FROM public.individual_free_worker_claims
    WHERE employer_id = p_employer_id;

    IF free_workers_used < 3 THEN
      INSERT INTO public.individual_free_worker_claims (employer_id, worker_profile_id)
      VALUES (p_employer_id, p_worker_profile_id);
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.payment_transactions pt
        WHERE pt.employer_id = p_employer_id
          AND pt.job_id = p_job_id
          AND pt.worker_profile_id IS NULL
          AND pt.payment_category = 'INDIVIDUAL_COMMISSION'
          AND pt.amount = 30.00
          AND pt.status = 'SUCCESS'
          AND pt.raw_webhook_payload->>'worker_profile_id' = p_worker_profile_id::text
      ) INTO has_paid_commission;
      IF NOT has_paid_commission THEN RAISE EXCEPTION 'COMMISSION_REQUIRED'; END IF;
    END IF;
  ELSIF selected_employer.employer_type = 'INDIVIDUAL' THEN
    NULL;
  END IF;

  UPDATE public.job_matches
  SET status = 'ACCEPTED'
  WHERE id = selected_match.id;

  accepted_workers := accepted_workers + 1;
  resulting_job_status := CASE
    WHEN accepted_workers >= selected_job.headcount_required THEN 'FILLED'
    ELSE 'SEARCHING'
  END;
  IF resulting_job_status = 'FILLED' THEN
    UPDATE public.jobs SET status = resulting_job_status WHERE id = p_job_id;
  END IF;

  RETURN QUERY SELECT selected_match.id, p_worker_profile_id, 'ACCEPTED', resulting_job_status, accepted_workers;
END;
$$;

COMMIT;
