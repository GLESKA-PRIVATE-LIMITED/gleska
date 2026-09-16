BEGIN;

CREATE OR REPLACE FUNCTION public.sync_worker_job_lifecycle()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'ACCEPTED' AND COALESCE(OLD.status, '') <> 'ACCEPTED' THEN
    UPDATE public.worker_profiles
    SET availability_status = 'ON_JOB'
    WHERE id = NEW.worker_profile_id
      AND availability_status = 'AVAILABLE';
  ELSIF NEW.status = 'COMPLETED' AND COALESCE(OLD.status, '') <> 'COMPLETED' THEN
    UPDATE public.worker_profiles
    SET availability_status = 'AVAILABLE', total_jobs = total_jobs + 1
    WHERE id = NEW.worker_profile_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.job_matches AS active_match
        WHERE active_match.worker_profile_id = NEW.worker_profile_id
          AND active_match.status IN ('ACCEPTED', 'IN_PROGRESS', 'ARRIVED')
          AND active_match.id <> NEW.id
      );
  ELSIF NEW.status = 'CANCELLED' AND COALESCE(OLD.status, '') <> 'CANCELLED' THEN
    UPDATE public.worker_profiles
    SET availability_status = 'AVAILABLE'
    WHERE id = NEW.worker_profile_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.job_matches AS active_match
        WHERE active_match.worker_profile_id = NEW.worker_profile_id
          AND active_match.status IN ('ACCEPTED', 'IN_PROGRESS', 'ARRIVED')
          AND active_match.id <> NEW.id
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_worker_job_lifecycle ON public.job_matches;
CREATE TRIGGER sync_worker_job_lifecycle
AFTER UPDATE OF status ON public.job_matches
FOR EACH ROW
EXECUTE FUNCTION public.sync_worker_job_lifecycle();

CREATE OR REPLACE FUNCTION public.cancel_job_for_employer(
  p_employer_id uuid,
  p_job_id uuid
)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  selected_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO selected_job
  FROM public.jobs
  WHERE id = p_job_id AND employer_id = p_employer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
  IF selected_job.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'JOB_ALREADY_COMPLETED';
  END IF;
  IF selected_job.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'JOB_ALREADY_CANCELLED';
  END IF;
  IF selected_job.status <> 'SEARCHING' THEN
    RAISE EXCEPTION 'JOB_NOT_CANCELLABLE';
  END IF;

  UPDATE public.job_matches
  SET status = 'CANCELLED'
  WHERE job_id = p_job_id
    AND status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'ARRIVED');

  UPDATE public.attendance
  SET check_out_at = COALESCE(check_out_at, NOW())
  WHERE job_id = p_job_id
    AND check_in_at IS NOT NULL
    AND check_out_at IS NULL;

  UPDATE public.jobs
  SET status = 'CANCELLED', updated_at = NOW()
  WHERE id = p_job_id
  RETURNING * INTO selected_job;

  RETURN selected_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_job_for_employer(
  p_employer_id uuid,
  p_job_id uuid
)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  selected_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO selected_job
  FROM public.jobs
  WHERE id = p_job_id AND employer_id = p_employer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
  IF selected_job.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'JOB_ALREADY_COMPLETED';
  END IF;
  IF selected_job.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'JOB_CANCELLED';
  END IF;
  IF selected_job.status <> 'FILLED' THEN
    RAISE EXCEPTION 'JOB_NOT_READY_FOR_COMPLETION';
  END IF;

  UPDATE public.job_matches
  SET status = 'COMPLETED', completed_at = COALESCE(completed_at, NOW())
  WHERE job_id = p_job_id
    AND status IN ('ACCEPTED', 'IN_PROGRESS', 'ARRIVED');

  UPDATE public.attendance
  SET check_out_at = COALESCE(check_out_at, NOW())
  WHERE job_id = p_job_id
    AND check_in_at IS NOT NULL
    AND check_out_at IS NULL;

  UPDATE public.jobs
  SET status = 'COMPLETED', updated_at = NOW()
  WHERE id = p_job_id
  RETURNING * INTO selected_job;

  RETURN selected_job;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_job_for_employer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_job_for_employer(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_job_for_employer(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_job_for_employer(uuid, uuid) TO service_role;

COMMIT;