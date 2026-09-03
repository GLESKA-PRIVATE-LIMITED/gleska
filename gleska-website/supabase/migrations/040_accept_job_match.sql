BEGIN;

CREATE OR REPLACE FUNCTION public.accept_job_match(
  p_employer_id uuid,
  p_job_id uuid,
  p_worker_profile_id uuid
)
RETURNS TABLE (
  match_id uuid,
  worker_profile_id uuid,
  match_status text,
  job_status text,
  accepted_count integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  selected_job public.jobs%ROWTYPE;
  selected_match public.job_matches%ROWTYPE;
  accepted_workers integer;
  resulting_job_status text;
BEGIN
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
    FROM public.get_current_job_match_workers(p_employer_id, p_job_id) AS current_match
    WHERE current_match.worker_profile_id = p_worker_profile_id
      AND current_match.status = 'PENDING'
  ) THEN
    RAISE EXCEPTION 'WORKER_NOT_ELIGIBLE';
  END IF;

  SELECT COUNT(*)::integer INTO accepted_workers
  FROM public.job_matches AS jm
  WHERE jm.job_id = p_job_id AND jm.status = 'ACCEPTED';
  IF accepted_workers >= selected_job.headcount_required THEN RAISE EXCEPTION 'HEADCOUNT_FILLED'; END IF;

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

REVOKE ALL ON FUNCTION public.accept_job_match(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_job_match(uuid, uuid, uuid) TO service_role;

COMMIT;