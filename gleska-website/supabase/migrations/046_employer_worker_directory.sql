BEGIN;

CREATE OR REPLACE FUNCTION public.list_employer_workers(
  p_page integer DEFAULT 1,
  p_limit integer DEFAULT 20,
  p_search text DEFAULT NULL,
  p_trade text DEFAULT NULL,
  p_skill text DEFAULT NULL,
  p_min_experience integer DEFAULT NULL,
  p_max_experience integer DEFAULT NULL,
  p_min_wage numeric DEFAULT NULL,
  p_max_wage numeric DEFAULT NULL,
  p_availability worker_availability DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_sort text DEFAULT 'name_asc',
  p_worker_id uuid DEFAULT NULL
)
RETURNS TABLE (
  worker_profile_id uuid,
  name text,
  profile_photo_path text,
  trade_id text,
  skills text[],
  experience_years integer,
  expected_daily_wage numeric,
  availability_status worker_availability,
  city text,
  state text,
  profile_completed boolean,
  is_verified boolean,
  total_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      profile.id AS worker_profile_id,
      worker.name,
      worker.profile_photo_path,
      profile.trade_id,
      profile.skills,
      profile.experience_years,
      profile.expected_daily_wage,
      profile.availability_status,
      profile.city,
      profile.state,
      profile.profile_completed,
      profile.is_verified
    FROM public.worker_profiles AS profile
    JOIN public.users AS worker ON worker.id = profile.user_id
    WHERE profile.profile_completed = TRUE
      AND worker.role = 'WORKER'
      AND (profile.expected_daily_wage IS NULL OR (profile.expected_daily_wage >= 0 AND profile.expected_daily_wage <= 1000000))
      AND (p_worker_id IS NULL OR profile.id = p_worker_id)
      AND (
        NULLIF(trim(p_search), '') IS NULL
        OR worker.name ILIKE '%' || trim(p_search) || '%'
        OR profile.trade_id ILIKE '%' || trim(p_search) || '%'
        OR EXISTS (
          SELECT 1 FROM unnest(COALESCE(profile.skills, '{}'::text[])) AS worker_skill(value)
          WHERE worker_skill.value ILIKE '%' || trim(p_search) || '%'
        )
      )
      AND (NULLIF(trim(p_trade), '') IS NULL OR lower(trim(profile.trade_id)) = lower(trim(p_trade)))
      AND (
        NULLIF(trim(p_skill), '') IS NULL
        OR EXISTS (
          SELECT 1 FROM unnest(COALESCE(profile.skills, '{}'::text[])) AS worker_skill(value)
          WHERE lower(trim(worker_skill.value)) = lower(trim(p_skill))
        )
      )
      AND (p_min_experience IS NULL OR profile.experience_years >= p_min_experience)
      AND (p_max_experience IS NULL OR profile.experience_years <= p_max_experience)
      AND (p_min_wage IS NULL OR profile.expected_daily_wage >= p_min_wage)
      AND (p_max_wage IS NULL OR profile.expected_daily_wage <= p_max_wage)
      AND (p_availability IS NULL OR profile.availability_status = p_availability)
      AND (NULLIF(trim(p_city), '') IS NULL OR lower(trim(profile.city)) = lower(trim(p_city)))
  ), counted AS (
    SELECT filtered.*, count(*) OVER () AS total_count
    FROM filtered
  )
  SELECT
    counted.worker_profile_id,
    counted.name,
    counted.profile_photo_path,
    counted.trade_id,
    counted.skills,
    counted.experience_years,
    counted.expected_daily_wage,
    counted.availability_status,
    counted.city,
    counted.state,
    counted.profile_completed,
    counted.is_verified,
    counted.total_count
  FROM counted
  ORDER BY
    CASE WHEN p_sort = 'experience_desc' THEN counted.experience_years END DESC NULLS LAST,
    CASE WHEN p_sort = 'wage_asc' THEN counted.expected_daily_wage END ASC NULLS LAST,
    CASE WHEN p_sort = 'wage_desc' THEN counted.expected_daily_wage END DESC NULLS LAST,
    CASE WHEN p_sort = 'name_desc' THEN lower(counted.name) END DESC,
    CASE WHEN p_sort <> 'name_desc' THEN lower(counted.name) END ASC,
    counted.worker_profile_id
  LIMIT CASE WHEN p_worker_id IS NOT NULL THEN 1 ELSE LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100) END
  OFFSET CASE WHEN p_worker_id IS NOT NULL THEN 0 ELSE (GREATEST(COALESCE(p_page, 1), 1) - 1) * LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100) END;
$$;

REVOKE ALL ON FUNCTION public.list_employer_workers(integer, integer, text, text, text, integer, integer, numeric, numeric, worker_availability, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_employer_workers(integer, integer, text, text, text, integer, integer, numeric, numeric, worker_availability, text, text, uuid) TO service_role;

CREATE INDEX IF NOT EXISTS idx_worker_profiles_directory_status
  ON public.worker_profiles(profile_completed, availability_status);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_directory_city
  ON public.worker_profiles(city);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_directory_skills
  ON public.worker_profiles USING GIN(skills);

COMMIT;