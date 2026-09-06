BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'attendance_status' AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.attendance_status AS ENUM ('PRESENT', 'LATE', 'ABSENT');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_match_id UUID NOT NULL REFERENCES public.job_matches(id) ON DELETE CASCADE,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  worker_profile_id UUID NOT NULL REFERENCES public.worker_profiles(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  job_site_id UUID NOT NULL REFERENCES public.job_sites(id) ON DELETE RESTRICT,
  attendance_date DATE NOT NULL,
  status public.attendance_status NOT NULL DEFAULT 'PRESENT',
  check_in_at TIMESTAMPTZ,
  check_in_latitude NUMERIC,
  check_in_longitude NUMERIC,
  check_in_accuracy NUMERIC,
  check_out_at TIMESTAMPTZ,
  check_out_latitude NUMERIC,
  check_out_longitude NUMERIC,
  check_out_accuracy NUMERIC,
  employer_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  correction_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_one_per_match_date UNIQUE (job_match_id, attendance_date),
  CONSTRAINT attendance_check_in_accuracy CHECK (check_in_accuracy IS NULL OR (check_in_accuracy > 0 AND check_in_accuracy <= 1000)),
  CONSTRAINT attendance_check_out_accuracy CHECK (check_out_accuracy IS NULL OR (check_out_accuracy > 0 AND check_out_accuracy <= 1000)),
  CONSTRAINT attendance_check_in_coordinates CHECK (
    (check_in_latitude IS NULL AND check_in_longitude IS NULL)
    OR (check_in_latitude BETWEEN -90 AND 90 AND check_in_longitude BETWEEN -180 AND 180)
  ),
  CONSTRAINT attendance_check_out_coordinates CHECK (
    (check_out_latitude IS NULL AND check_out_longitude IS NULL)
    OR (check_out_latitude BETWEEN -90 AND 90 AND check_out_longitude BETWEEN -180 AND 180)
  ),
  CONSTRAINT attendance_checkout_requires_checkin CHECK (check_out_at IS NULL OR check_in_at IS NOT NULL),
  CONSTRAINT attendance_checkout_after_checkin CHECK (check_out_at IS NULL OR check_out_at >= check_in_at)
);

CREATE TABLE IF NOT EXISTS public.attendance_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id UUID NOT NULL REFERENCES public.attendance(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('WORKER', 'EMPLOYER', 'ADMIN')),
  action TEXT NOT NULL,
  previous_status public.attendance_status,
  new_status public.attendance_status,
  previous_check_in_at TIMESTAMPTZ,
  new_check_in_at TIMESTAMPTZ,
  previous_check_out_at TIMESTAMPTZ,
  new_check_out_at TIMESTAMPTZ,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_employer_date
  ON public.attendance(employer_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_worker_date
  ON public.attendance(worker_profile_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_job_match
  ON public.attendance(job_match_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status
  ON public.attendance(status);
CREATE INDEX IF NOT EXISTS idx_attendance_audit_attendance
  ON public.attendance_audit(attendance_id, created_at DESC);

DROP TRIGGER IF EXISTS update_attendance_updated_at ON public.attendance;
CREATE TRIGGER update_attendance_updated_at
  BEFORE UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workers can view their own attendance" ON public.attendance;
CREATE POLICY "Workers can view their own attendance"
  ON public.attendance FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.worker_profiles wp
    WHERE wp.id = attendance.worker_profile_id AND wp.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Employers can view attendance for their jobs" ON public.attendance;
CREATE POLICY "Employers can view attendance for their jobs"
  ON public.attendance FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employer_profiles ep
    WHERE ep.id = attendance.employer_id AND ep.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Service role can manage attendance" ON public.attendance;
CREATE POLICY "Service role can manage attendance"
  ON public.attendance FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Workers can view their attendance audit" ON public.attendance_audit;
CREATE POLICY "Workers can view their attendance audit"
  ON public.attendance_audit FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.attendance a
    JOIN public.worker_profiles wp ON wp.id = a.worker_profile_id
    WHERE a.id = attendance_audit.attendance_id AND wp.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Employers can view their attendance audit" ON public.attendance_audit;
CREATE POLICY "Employers can view their attendance audit"
  ON public.attendance_audit FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.attendance a
    JOIN public.employer_profiles ep ON ep.id = a.employer_id
    WHERE a.id = attendance_audit.attendance_id AND ep.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Service role can manage attendance audit" ON public.attendance_audit;
CREATE POLICY "Service role can manage attendance audit"
  ON public.attendance_audit FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.worker_check_in(
  p_user_id UUID,
  p_job_match_id UUID,
  p_latitude NUMERIC,
  p_longitude NUMERIC,
  p_accuracy NUMERIC,
  p_geofence_meters NUMERIC DEFAULT 500
)
RETURNS TABLE (
  id UUID,
  job_match_id UUID,
  worker_profile_id UUID,
  job_id UUID,
  job_site_id UUID,
  worker_name TEXT,
  job_title TEXT,
  site_name TEXT,
  attendance_date DATE,
  status public.attendance_status,
  check_in_at TIMESTAMPTZ,
  check_out_at TIMESTAMPTZ,
  employer_manual_override BOOLEAN,
  correction_reason TEXT,
  distance_m NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  worker_id UUID;
  match_row public.job_matches%ROWTYPE;
  site_row public.job_sites%ROWTYPE;
  current_location public.worker_current_locations%ROWTYPE;
  distance_value NUMERIC;
  attendance_row public.attendance%ROWTYPE;
BEGIN
  SELECT wp.id INTO worker_id
  FROM public.worker_profiles wp
  WHERE wp.user_id = p_user_id;
  IF worker_id IS NULL THEN RAISE EXCEPTION 'WORKER_PROFILE_NOT_FOUND'; END IF;
  IF p_accuracy <= 0 OR p_accuracy > 1000 THEN RAISE EXCEPTION 'INVALID_GPS_ACCURACY'; END IF;

  SELECT jm.* INTO match_row
  FROM public.job_matches jm
  WHERE jm.id = p_job_match_id AND jm.worker_profile_id = worker_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_MATCH_NOT_FOUND'; END IF;
  IF match_row.status <> 'ACCEPTED' THEN RAISE EXCEPTION 'JOB_MATCH_NOT_ACCEPTED'; END IF;

  SELECT js.* INTO site_row
  FROM public.job_sites js
  JOIN public.jobs j ON j.job_site_id = js.id
  WHERE j.id = match_row.job_id AND j.employer_id IS NOT NULL;
  IF NOT FOUND OR site_row.location IS NULL THEN RAISE EXCEPTION 'JOB_SITE_LOCATION_UNAVAILABLE'; END IF;

  SELECT wcl.* INTO current_location
  FROM public.worker_current_locations wcl
  WHERE wcl.worker_profile_id = worker_id;
  IF NOT FOUND OR current_location.updated_at < NOW() - INTERVAL '10 minutes'
    OR current_location.accuracy_m > 1000 THEN
    RAISE EXCEPTION 'CURRENT_LOCATION_REQUIRED';
  END IF;

  distance_value := ST_DistanceSphere(
    ST_SetSRID(ST_MakePoint(current_location.longitude, current_location.latitude), 4326),
    site_row.location
  );
  IF distance_value > p_geofence_meters THEN RAISE EXCEPTION 'OUTSIDE_ATTENDANCE_GEOFENCE'; END IF;

  SELECT a.* INTO attendance_row
  FROM public.attendance a
  WHERE a.job_match_id = p_job_match_id AND a.attendance_date = CURRENT_DATE
  FOR UPDATE;
  IF FOUND THEN RAISE EXCEPTION 'ATTENDANCE_ALREADY_EXISTS'; END IF;

  INSERT INTO public.attendance (
    job_match_id, employer_id, worker_profile_id, job_id, job_site_id,
    attendance_date, status, check_in_at, check_in_latitude,
    check_in_longitude, check_in_accuracy
  )
  SELECT match_row.id, j.employer_id, worker_id, j.id, j.job_site_id,
    CURRENT_DATE, 'PRESENT', NOW(), current_location.latitude,
    current_location.longitude, current_location.accuracy_m
  FROM public.jobs j
  WHERE j.id = match_row.job_id
  RETURNING * INTO attendance_row;

  RETURN QUERY
  SELECT attendance_row.id, attendance_row.job_match_id, attendance_row.worker_profile_id,
    attendance_row.job_id, attendance_row.job_site_id, u.name, j.title, site_row.name,
    attendance_row.attendance_date, attendance_row.status, attendance_row.check_in_at,
    attendance_row.check_out_at, attendance_row.employer_manual_override,
    attendance_row.correction_reason, distance_value
  FROM public.users u
  JOIN public.jobs j ON j.id = attendance_row.job_id
  WHERE u.id = (SELECT user_id FROM public.worker_profiles WHERE id = worker_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.worker_check_out(
  p_user_id UUID,
  p_attendance_id UUID,
  p_latitude NUMERIC,
  p_longitude NUMERIC,
  p_accuracy NUMERIC,
  p_geofence_meters NUMERIC DEFAULT 500
)
RETURNS TABLE (
  id UUID,
  job_match_id UUID,
  worker_profile_id UUID,
  job_id UUID,
  job_site_id UUID,
  worker_name TEXT,
  job_title TEXT,
  site_name TEXT,
  attendance_date DATE,
  status public.attendance_status,
  check_in_at TIMESTAMPTZ,
  check_out_at TIMESTAMPTZ,
  employer_manual_override BOOLEAN,
  correction_reason TEXT,
  distance_m NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  worker_id UUID;
  attendance_row public.attendance%ROWTYPE;
  site_row public.job_sites%ROWTYPE;
  current_location public.worker_current_locations%ROWTYPE;
  distance_value NUMERIC;
BEGIN
  SELECT wp.id INTO worker_id FROM public.worker_profiles wp WHERE wp.user_id = p_user_id;
  IF worker_id IS NULL THEN RAISE EXCEPTION 'WORKER_PROFILE_NOT_FOUND'; END IF;
  IF p_accuracy <= 0 OR p_accuracy > 1000 THEN RAISE EXCEPTION 'INVALID_GPS_ACCURACY'; END IF;

  SELECT a.* INTO attendance_row
  FROM public.attendance a
  WHERE a.id = p_attendance_id AND a.worker_profile_id = worker_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ATTENDANCE_NOT_FOUND'; END IF;
  IF attendance_row.check_in_at IS NULL THEN RAISE EXCEPTION 'CHECK_IN_REQUIRED'; END IF;
  IF attendance_row.check_out_at IS NOT NULL THEN RAISE EXCEPTION 'ATTENDANCE_ALREADY_CHECKED_OUT'; END IF;

  SELECT js.* INTO site_row FROM public.job_sites js WHERE js.id = attendance_row.job_site_id;
  IF NOT FOUND OR site_row.location IS NULL THEN RAISE EXCEPTION 'JOB_SITE_LOCATION_UNAVAILABLE'; END IF;
  SELECT wcl.* INTO current_location FROM public.worker_current_locations wcl WHERE wcl.worker_profile_id = worker_id;
  IF NOT FOUND OR current_location.updated_at < NOW() - INTERVAL '10 minutes' OR current_location.accuracy_m > 1000 THEN
    RAISE EXCEPTION 'CURRENT_LOCATION_REQUIRED';
  END IF;
  distance_value := ST_DistanceSphere(
    ST_SetSRID(ST_MakePoint(current_location.longitude, current_location.latitude), 4326),
    site_row.location
  );
  IF distance_value > p_geofence_meters THEN RAISE EXCEPTION 'OUTSIDE_ATTENDANCE_GEOFENCE'; END IF;

  UPDATE public.attendance
  SET check_out_at = NOW(), check_out_latitude = current_location.latitude,
      check_out_longitude = current_location.longitude, check_out_accuracy = current_location.accuracy_m
  WHERE id = attendance_row.id
  RETURNING * INTO attendance_row;

  RETURN QUERY
  SELECT attendance_row.id, attendance_row.job_match_id, attendance_row.worker_profile_id,
    attendance_row.job_id, attendance_row.job_site_id, u.name, j.title, site_row.name,
    attendance_row.attendance_date, attendance_row.status, attendance_row.check_in_at,
    attendance_row.check_out_at, attendance_row.employer_manual_override,
    attendance_row.correction_reason, distance_value
  FROM public.users u
  JOIN public.worker_profiles wp ON wp.user_id = u.id
  JOIN public.jobs j ON j.id = attendance_row.job_id
  WHERE wp.id = worker_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_worker_attendance(
  p_user_id UUID,
  p_date DATE DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID, job_match_id UUID, worker_profile_id UUID, job_id UUID, job_site_id UUID,
  worker_name TEXT, job_title TEXT, site_name TEXT, attendance_date DATE,
  status public.attendance_status, check_in_at TIMESTAMPTZ, check_out_at TIMESTAMPTZ,
  employer_manual_override BOOLEAN, correction_reason TEXT, total_count BIGINT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH worker AS (SELECT id FROM public.worker_profiles WHERE user_id = p_user_id), rows AS (
    SELECT a.*, u.name AS worker_name, j.title AS job_title, js.name AS site_name,
      COUNT(*) OVER () AS total_count
    FROM public.attendance a
    JOIN worker w ON w.id = a.worker_profile_id
    JOIN public.users u ON u.id = (SELECT user_id FROM public.worker_profiles WHERE id = a.worker_profile_id)
    JOIN public.jobs j ON j.id = a.job_id
    JOIN public.job_sites js ON js.id = a.job_site_id
    WHERE (p_date IS NULL OR a.attendance_date = p_date)
    ORDER BY a.attendance_date DESC, a.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    OFFSET (GREATEST(COALESCE(p_page, 1), 1) - 1) * LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
  )
  SELECT id, job_match_id, worker_profile_id, job_id, job_site_id, worker_name,
    job_title, site_name, attendance_date, status, check_in_at, check_out_at,
    employer_manual_override, correction_reason, total_count FROM rows;
$$;

CREATE OR REPLACE FUNCTION public.list_employer_attendance(
  p_user_id UUID,
  p_date DATE DEFAULT NULL,
  p_worker_search TEXT DEFAULT NULL,
  p_job_id UUID DEFAULT NULL,
  p_job_site_id UUID DEFAULT NULL,
  p_status public.attendance_status DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID, job_match_id UUID, worker_profile_id UUID, employer_id UUID, job_id UUID,
  job_site_id UUID, worker_name TEXT, job_title TEXT, site_name TEXT, attendance_date DATE,
  status public.attendance_status, check_in_at TIMESTAMPTZ, check_out_at TIMESTAMPTZ,
  employer_manual_override BOOLEAN, correction_reason TEXT, total_count BIGINT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH employer AS (SELECT id FROM public.employer_profiles WHERE user_id = p_user_id), rows AS (
    SELECT a.*, u.name AS worker_name, j.title AS job_title, js.name AS site_name,
      COUNT(*) OVER () AS total_count
    FROM public.attendance a
    JOIN employer e ON e.id = a.employer_id
    JOIN public.worker_profiles wp ON wp.id = a.worker_profile_id
    JOIN public.users u ON u.id = wp.user_id
    JOIN public.jobs j ON j.id = a.job_id
    JOIN public.job_sites js ON js.id = a.job_site_id
    WHERE (NULLIF(trim(p_worker_search), '') IS NULL OR u.name ILIKE '%' || trim(p_worker_search) || '%')
      AND (p_date IS NULL OR a.attendance_date = p_date)
      AND (p_job_id IS NULL OR a.job_id = p_job_id)
      AND (p_job_site_id IS NULL OR a.job_site_id = p_job_site_id)
      AND (p_status IS NULL OR a.status = p_status)
    ORDER BY a.attendance_date DESC, a.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    OFFSET (GREATEST(COALESCE(p_page, 1), 1) - 1) * LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
  )
  SELECT id, job_match_id, worker_profile_id, employer_id, job_id, job_site_id,
    worker_name, job_title, site_name, attendance_date, status, check_in_at,
    check_out_at, employer_manual_override, correction_reason, total_count FROM rows;
$$;

CREATE OR REPLACE FUNCTION public.get_employer_attendance(
  p_user_id UUID,
  p_attendance_id UUID
)
RETURNS TABLE (
  id UUID, job_match_id UUID, worker_profile_id UUID, employer_id UUID, job_id UUID,
  job_site_id UUID, worker_name TEXT, job_title TEXT, site_name TEXT, attendance_date DATE,
  status public.attendance_status, check_in_at TIMESTAMPTZ, check_out_at TIMESTAMPTZ,
  employer_manual_override BOOLEAN, correction_reason TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.id, a.job_match_id, a.worker_profile_id, a.employer_id, a.job_id, a.job_site_id,
    u.name, j.title, js.name, a.attendance_date, a.status, a.check_in_at, a.check_out_at,
    a.employer_manual_override, a.correction_reason
  FROM public.attendance a
  JOIN public.employer_profiles ep ON ep.id = a.employer_id AND ep.user_id = p_user_id
  JOIN public.worker_profiles wp ON wp.id = a.worker_profile_id
  JOIN public.users u ON u.id = wp.user_id
  JOIN public.jobs j ON j.id = a.job_id
  JOIN public.job_sites js ON js.id = a.job_site_id
  WHERE a.id = p_attendance_id;
$$;

CREATE OR REPLACE FUNCTION public.update_employer_attendance(
  p_user_id UUID,
  p_attendance_id UUID,
  p_status public.attendance_status,
  p_check_in_at TIMESTAMPTZ,
  p_check_out_at TIMESTAMPTZ,
  p_reason TEXT
)
RETURNS TABLE (
  id UUID, job_match_id UUID, worker_profile_id UUID, employer_id UUID, job_id UUID,
  job_site_id UUID, worker_name TEXT, job_title TEXT, site_name TEXT, attendance_date DATE,
  status public.attendance_status, check_in_at TIMESTAMPTZ, check_out_at TIMESTAMPTZ,
  employer_manual_override BOOLEAN, correction_reason TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  current_row public.attendance%ROWTYPE;
  updated_row public.attendance%ROWTYPE;
BEGIN
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'CORRECTION_REASON_REQUIRED'; END IF;
  IF p_check_out_at IS NOT NULL AND p_check_in_at IS NULL THEN RAISE EXCEPTION 'CHECK_IN_REQUIRED'; END IF;
  IF p_check_out_at IS NOT NULL AND p_check_in_at IS NOT NULL AND p_check_out_at < p_check_in_at THEN RAISE EXCEPTION 'CHECK_OUT_BEFORE_CHECK_IN'; END IF;
  SELECT a.* INTO current_row
  FROM public.attendance a
  JOIN public.employer_profiles ep ON ep.id = a.employer_id AND ep.user_id = p_user_id
  WHERE a.id = p_attendance_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ATTENDANCE_NOT_FOUND'; END IF;

  UPDATE public.attendance
  SET status = p_status, check_in_at = p_check_in_at, check_out_at = p_check_out_at,
      employer_manual_override = TRUE, correction_reason = trim(p_reason)
  WHERE id = current_row.id
  RETURNING * INTO updated_row;

  INSERT INTO public.attendance_audit (
    attendance_id, actor_user_id, actor_role, action, previous_status, new_status,
    previous_check_in_at, new_check_in_at, previous_check_out_at, new_check_out_at, reason
  ) VALUES (
    current_row.id, p_user_id, 'EMPLOYER', 'MANUAL_CORRECTION', current_row.status,
    updated_row.status, current_row.check_in_at, updated_row.check_in_at,
    current_row.check_out_at, updated_row.check_out_at, trim(p_reason)
  );

  RETURN QUERY SELECT * FROM public.get_employer_attendance(p_user_id, current_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_attendance_audit(
  p_user_id UUID,
  p_attendance_id UUID
)
RETURNS TABLE (
  id UUID, attendance_id UUID, actor_user_id UUID, actor_role TEXT, action TEXT,
  previous_status public.attendance_status, new_status public.attendance_status,
  previous_check_in_at TIMESTAMPTZ, new_check_in_at TIMESTAMPTZ,
  previous_check_out_at TIMESTAMPTZ, new_check_out_at TIMESTAMPTZ,
  reason TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT aa.id, aa.attendance_id, aa.actor_user_id, aa.actor_role, aa.action,
    aa.previous_status, aa.new_status, aa.previous_check_in_at, aa.new_check_in_at,
    aa.previous_check_out_at, aa.new_check_out_at, aa.reason, aa.created_at
  FROM public.attendance_audit aa
  JOIN public.attendance a ON a.id = aa.attendance_id
  JOIN public.employer_profiles ep ON ep.id = a.employer_id AND ep.user_id = p_user_id
  WHERE aa.attendance_id = p_attendance_id
  ORDER BY aa.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.mark_employer_attendance(
  p_user_id UUID,
  p_job_match_id UUID,
  p_attendance_date DATE,
  p_status public.attendance_status,
  p_reason TEXT
)
RETURNS TABLE (
  id UUID, job_match_id UUID, worker_profile_id UUID, employer_id UUID, job_id UUID,
  job_site_id UUID, worker_name TEXT, job_title TEXT, site_name TEXT, attendance_date DATE,
  status public.attendance_status, check_in_at TIMESTAMPTZ, check_out_at TIMESTAMPTZ,
  employer_manual_override BOOLEAN, correction_reason TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  match_row public.job_matches%ROWTYPE;
  current_row public.attendance%ROWTYPE;
  updated_row public.attendance%ROWTYPE;
BEGIN
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'CORRECTION_REASON_REQUIRED'; END IF;
  SELECT jm.* INTO match_row
  FROM public.job_matches jm
  JOIN public.jobs j ON j.id = jm.job_id
  JOIN public.employer_profiles ep ON ep.id = j.employer_id AND ep.user_id = p_user_id
  WHERE jm.id = p_job_match_id AND jm.status = 'ACCEPTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_MATCH_NOT_FOUND'; END IF;

  SELECT a.* INTO current_row
  FROM public.attendance a
  WHERE a.job_match_id = p_job_match_id AND a.attendance_date = p_attendance_date
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.attendance
    SET status = p_status, employer_manual_override = TRUE, correction_reason = trim(p_reason)
    WHERE id = current_row.id
    RETURNING * INTO updated_row;
  ELSE
    INSERT INTO public.attendance (
      job_match_id, employer_id, worker_profile_id, job_id, job_site_id,
      attendance_date, status, employer_manual_override, correction_reason
    )
    SELECT match_row.id, j.employer_id, match_row.worker_profile_id, j.id, j.job_site_id,
      p_attendance_date, p_status, TRUE, trim(p_reason)
    FROM public.jobs j WHERE j.id = match_row.job_id
    RETURNING * INTO updated_row;
  END IF;

  INSERT INTO public.attendance_audit (
    attendance_id, actor_user_id, actor_role, action, previous_status, new_status,
    previous_check_in_at, new_check_in_at, previous_check_out_at, new_check_out_at, reason
  ) VALUES (
    updated_row.id, p_user_id, 'EMPLOYER', 'MANUAL_MARK',
    current_row.status, updated_row.status, current_row.check_in_at, updated_row.check_in_at,
    current_row.check_out_at, updated_row.check_out_at, trim(p_reason)
  );

  RETURN QUERY SELECT * FROM public.get_employer_attendance(p_user_id, updated_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_employer_attendance_summary(
  p_user_id UUID,
  p_date DATE DEFAULT NULL,
  p_worker_search TEXT DEFAULT NULL,
  p_job_id UUID DEFAULT NULL,
  p_job_site_id UUID DEFAULT NULL,
  p_status public.attendance_status DEFAULT NULL
)
RETURNS TABLE (present_count BIGINT, late_count BIGINT, absent_count BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE a.status = 'PRESENT'),
    COUNT(*) FILTER (WHERE a.status = 'LATE'),
    COUNT(*) FILTER (WHERE a.status = 'ABSENT')
  FROM public.attendance a
  JOIN public.employer_profiles ep ON ep.id = a.employer_id AND ep.user_id = p_user_id
  JOIN public.worker_profiles wp ON wp.id = a.worker_profile_id
  JOIN public.users u ON u.id = wp.user_id
  WHERE (NULLIF(trim(p_worker_search), '') IS NULL OR u.name ILIKE '%' || trim(p_worker_search) || '%')
    AND (p_date IS NULL OR a.attendance_date = p_date)
    AND (p_job_id IS NULL OR a.job_id = p_job_id)
    AND (p_job_site_id IS NULL OR a.job_site_id = p_job_site_id)
    AND (p_status IS NULL OR a.status = p_status);
$$;

CREATE OR REPLACE FUNCTION public.list_employer_accepted_matches(p_user_id UUID)
RETURNS TABLE (job_match_id UUID, worker_name TEXT, job_title TEXT, site_name TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT jm.id, u.name, j.title, js.name
  FROM public.job_matches jm
  JOIN public.jobs j ON j.id = jm.job_id
  JOIN public.job_sites js ON js.id = j.job_site_id
  JOIN public.employer_profiles ep ON ep.id = j.employer_id AND ep.user_id = p_user_id
  JOIN public.worker_profiles wp ON wp.id = jm.worker_profile_id
  JOIN public.users u ON u.id = wp.user_id
  WHERE jm.status = 'ACCEPTED'
  ORDER BY j.created_at DESC, u.name ASC;
$$;

REVOKE ALL ON FUNCTION public.worker_check_in(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_check_out(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_worker_attendance(UUID, DATE, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_employer_attendance(UUID, DATE, TEXT, UUID, UUID, public.attendance_status, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_employer_attendance(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_employer_attendance(UUID, UUID, public.attendance_status, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_attendance_audit(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_employer_attendance(UUID, UUID, DATE, public.attendance_status, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_employer_attendance_summary(UUID, DATE, TEXT, UUID, UUID, public.attendance_status) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_employer_accepted_matches(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.worker_check_in(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_check_out(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_worker_attendance(UUID, DATE, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_employer_attendance(UUID, DATE, TEXT, UUID, UUID, public.attendance_status, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_employer_attendance(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_employer_attendance(UUID, UUID, public.attendance_status, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_attendance_audit(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_employer_attendance(UUID, UUID, DATE, public.attendance_status, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_employer_attendance_summary(UUID, DATE, TEXT, UUID, UUID, public.attendance_status) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_employer_accepted_matches(UUID) TO service_role;

COMMIT;
