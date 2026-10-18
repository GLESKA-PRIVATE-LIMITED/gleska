BEGIN;

CREATE OR REPLACE FUNCTION public.reject_job_match(
  p_employer_id uuid,
  p_job_id uuid,
  p_worker_profile_id uuid
)
RETURNS TABLE (
  match_id uuid,
  worker_profile_id uuid,
  match_status text,
  job_status text,
  rejected_count integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  selected_job public.jobs%ROWTYPE;
  selected_match public.job_matches%ROWTYPE;
  rejected_workers integer;
BEGIN
  SELECT * INTO selected_job
  FROM public.jobs AS j
  WHERE j.id = p_job_id AND j.employer_id = p_employer_id
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

  UPDATE public.job_matches AS jm
  SET status = 'REJECTED'
  WHERE jm.id = selected_match.id;

  SELECT COUNT(*)::integer INTO rejected_workers
  FROM public.job_matches AS jm
  WHERE jm.job_id = p_job_id AND jm.status = 'REJECTED';

  RETURN QUERY SELECT selected_match.id, p_worker_profile_id, 'REJECTED', selected_job.status, rejected_workers;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_job_match(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_job_match(uuid, uuid, uuid) TO service_role;

COMMIT;
