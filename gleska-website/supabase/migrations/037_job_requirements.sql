BEGIN;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS trade_id TEXT,
  ADD COLUMN IF NOT EXISTS required_skills TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

DROP FUNCTION IF EXISTS public.create_job_for_employer(UUID, UUID, TEXT, INTEGER, NUMERIC, INTEGER);

CREATE OR REPLACE FUNCTION public.create_job_for_employer(
  p_employer_id UUID,
  p_job_site_id UUID,
  p_title TEXT,
  p_headcount_required INTEGER,
  p_max_daily_salary NUMERIC DEFAULT NULL,
  p_min_experience INTEGER DEFAULT NULL,
  p_trade_id TEXT DEFAULT NULL,
  p_required_skills TEXT[] DEFAULT '{}'::TEXT[]
)
RETURNS public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  employer public.employer_profiles%ROWTYPE;
  created_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO employer FROM public.employer_profiles WHERE id = p_employer_id FOR UPDATE;
  IF NOT FOUND OR employer.onboarding_status <> 'COMPLETED' THEN RAISE EXCEPTION 'EMPLOYER_ONBOARDING_INCOMPLETE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_sites WHERE id = p_job_site_id AND employer_id = p_employer_id) THEN RAISE EXCEPTION 'JOB_SITE_NOT_FOUND'; END IF;
  IF employer.subscription_valid_until IS NULL OR employer.subscription_valid_until <= NOW() THEN
    IF employer.has_availed_free_dispatch THEN RAISE EXCEPTION 'SUBSCRIPTION_REQUIRED'; END IF;
    employer.has_availed_free_dispatch := TRUE;
    UPDATE public.employer_profiles SET has_availed_free_dispatch = TRUE WHERE id = p_employer_id;
  END IF;
  INSERT INTO public.jobs (employer_id, job_site_id, title, headcount_required, max_daily_salary, min_experience, trade_id, required_skills, status)
  VALUES (p_employer_id, p_job_site_id, p_title, p_headcount_required, p_max_daily_salary, p_min_experience, p_trade_id, COALESCE(p_required_skills, '{}'::TEXT[]), 'SEARCHING')
  RETURNING * INTO created_job;
  RETURN created_job;
END;
$$;

REVOKE ALL ON FUNCTION public.create_job_for_employer(UUID, UUID, TEXT, INTEGER, NUMERIC, INTEGER, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_job_for_employer(UUID, UUID, TEXT, INTEGER, NUMERIC, INTEGER, TEXT, TEXT[]) TO service_role;

COMMIT;
