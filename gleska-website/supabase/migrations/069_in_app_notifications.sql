BEGIN;

ALTER TABLE public.security_activity
  ADD COLUMN IF NOT EXISTS event_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_activity_user_event_key
  ON public.security_activity (user_id, event_key);

DROP POLICY IF EXISTS "Users can insert their own security activity" ON public.security_activity;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.security_activity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.security_activity TO authenticated;
GRANT ALL ON TABLE public.security_activity TO service_role;

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('job_matching', 'attendance', 'security')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  entity_type TEXT,
  entity_id UUID,
  event_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notifications_user_event_key_unique UNIQUE (user_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can mark their own notifications read" ON public.notifications;
CREATE POLICY "Users can mark their own notifications read"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage notifications" ON public.notifications;
CREATE POLICY "Service role can manage notifications"
  ON public.notifications FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT UPDATE (read_at) ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;

CREATE OR REPLACE FUNCTION public.create_in_app_notification(
  p_user_id UUID,
  p_category TEXT,
  p_title TEXT,
  p_message TEXT,
  p_event_key TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_event_key IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.notifications (
    user_id, category, title, message, event_key, entity_type, entity_id
  )
  VALUES (
    p_user_id, p_category, p_title, p_message, p_event_key, p_entity_type, p_entity_id
  )
  ON CONFLICT (user_id, event_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.create_in_app_notification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.revoke_account_session(
  p_user_id UUID,
  p_session_id UUID
)
RETURNS TABLE (
  id UUID,
  device_name TEXT,
  browser TEXT,
  os TEXT,
  city TEXT,
  country TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  revoked_session public.user_sessions%ROWTYPE;
BEGIN
  UPDATE public.user_sessions AS session
  SET is_revoked = TRUE,
      revoked_at = NOW()
  WHERE session.id = p_session_id
    AND session.user_id = p_user_id
    AND session.is_revoked = FALSE
  RETURNING session.* INTO revoked_session;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.security_activity (
    user_id, event_type, event_key, description, device_name, browser, os, city, country
  )
  VALUES (
    p_user_id,
    'session_revoked',
    'session_revoked:' || p_session_id::TEXT,
    'Session revoked: ' || COALESCE(revoked_session.device_name, 'Unknown device'),
    revoked_session.device_name,
    revoked_session.browser,
    revoked_session.os,
    revoked_session.city,
    revoked_session.country
  )
  ON CONFLICT (user_id, event_key) DO NOTHING;

  RETURN QUERY
  SELECT revoked_session.id, revoked_session.device_name, revoked_session.browser,
    revoked_session.os, revoked_session.city, revoked_session.country;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_account_session(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_account_session(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.logout_account_session(
  p_user_id UUID,
  p_session_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  revoked_session public.user_sessions%ROWTYPE;
BEGIN
  UPDATE public.user_sessions AS session
  SET is_revoked = TRUE,
      revoked_at = NOW()
  WHERE session.user_id = p_user_id
    AND session.session_key = p_session_key
    AND session.is_revoked = FALSE
  RETURNING session.* INTO revoked_session;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.security_activity (
    user_id, event_type, event_key, description, device_name, browser, os, city, country
  )
  VALUES (
    p_user_id,
    'logout',
    'logout:' || p_session_key,
    'Signed out from ' || COALESCE(revoked_session.device_name, 'Unknown device'),
    revoked_session.device_name,
    revoked_session.browser,
    revoked_session.os,
    revoked_session.city,
    revoked_session.country
  )
  ON CONFLICT (user_id, event_key) DO NOTHING;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.logout_account_session(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logout_account_session(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_job_match_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_user_id UUID;
  employer_user_id UUID;
  job_title TEXT;
  event_suffix TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'PENDING' THEN
    event_suffix := 'pending';
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'ACCEPTED' THEN
    event_suffix := 'accepted';
  ELSE
    RETURN NEW;
  END IF;

  SELECT wp.user_id
  INTO worker_user_id
  FROM public.worker_profiles AS wp
  WHERE wp.id = NEW.worker_profile_id;

  SELECT ep.user_id, j.title
  INTO employer_user_id, job_title
  FROM public.jobs AS j
  JOIN public.employer_profiles AS ep ON ep.id = j.employer_id
  WHERE j.id = NEW.job_id;

  IF event_suffix = 'pending' THEN
    IF COALESCE((
      SELECT preference.job_matching_notifications
      FROM public.worker_preferences AS preference
      WHERE preference.user_id = worker_user_id
    ), TRUE) THEN
      PERFORM public.create_in_app_notification(
        worker_user_id,
        'job_matching',
        'New job match',
        'A job match is available for ' || COALESCE(job_title, 'a job'),
        'job_match:' || NEW.id::TEXT || ':pending',
        'job_match',
        NEW.id
      );
    END IF;

    IF COALESCE((
      SELECT preference.job_matching_notifications
      FROM public.employer_preferences AS preference
      WHERE preference.user_id = employer_user_id
    ), TRUE) THEN
      PERFORM public.create_in_app_notification(
        employer_user_id,
        'job_matching',
        'New worker match',
        'A worker match is available for ' || COALESCE(job_title, 'your job'),
        'job_match:' || NEW.id::TEXT || ':pending',
        'job_match',
        NEW.id
      );
    END IF;
  ELSE
    IF COALESCE((
      SELECT preference.job_matching_notifications
      FROM public.worker_preferences AS preference
      WHERE preference.user_id = worker_user_id
    ), TRUE) THEN
      PERFORM public.create_in_app_notification(
        worker_user_id,
        'job_matching',
        'Job match accepted',
        'Your match for ' || COALESCE(job_title, 'a job') || ' was accepted.',
        'job_match:' || NEW.id::TEXT || ':accepted',
        'job_match',
        NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_job_match_event ON public.job_matches;
CREATE TRIGGER notify_job_match_event
  AFTER INSERT OR UPDATE OF status ON public.job_matches
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_job_match_event();

CREATE OR REPLACE FUNCTION public.notify_attendance_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  employer_user_id UUID;
  job_title TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.check_in_at IS NULL OR NEW.employer_manual_override THEN
      RETURN NEW;
    END IF;

    SELECT ep.user_id, j.title
    INTO employer_user_id, job_title
    FROM public.employer_profiles AS ep
    JOIN public.jobs AS j ON j.employer_id = ep.id
    WHERE ep.id = NEW.employer_id AND j.id = NEW.job_id;

    IF COALESCE((
      SELECT preference.attendance_notifications
      FROM public.employer_preferences AS preference
      WHERE preference.user_id = employer_user_id
    ), TRUE) THEN
      PERFORM public.create_in_app_notification(
        employer_user_id,
        'attendance',
        'Worker checked in',
        'A worker checked in for ' || COALESCE(job_title, 'a job') || '.',
        'attendance:' || NEW.id::TEXT || ':check_in',
        'attendance',
        NEW.id
      );
    END IF;
  ELSIF OLD.check_out_at IS NULL
    AND NEW.check_out_at IS NOT NULL
    AND NOT OLD.employer_manual_override
    AND NOT NEW.employer_manual_override THEN
    SELECT ep.user_id, j.title
    INTO employer_user_id, job_title
    FROM public.employer_profiles AS ep
    JOIN public.jobs AS j ON j.employer_id = ep.id
    WHERE ep.id = NEW.employer_id AND j.id = NEW.job_id;

    IF COALESCE((
      SELECT preference.attendance_notifications
      FROM public.employer_preferences AS preference
      WHERE preference.user_id = employer_user_id
    ), TRUE) THEN
      PERFORM public.create_in_app_notification(
        employer_user_id,
        'attendance',
        'Worker checked out',
        'A worker checked out from ' || COALESCE(job_title, 'a job') || '.',
        'attendance:' || NEW.id::TEXT || ':check_out',
        'attendance',
        NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_attendance_event ON public.attendance;
CREATE TRIGGER notify_attendance_event
  AFTER INSERT OR UPDATE OF check_out_at ON public.attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_attendance_event();

CREATE OR REPLACE FUNCTION public.notify_employer_attendance_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_user_id UUID;
  attendance_date DATE;
  job_title TEXT;
BEGIN
  IF NEW.actor_role <> 'EMPLOYER'
    OR NEW.action NOT IN ('MANUAL_MARK', 'MANUAL_CORRECTION') THEN
    RETURN NEW;
  END IF;

  SELECT wp.user_id, a.attendance_date, j.title
  INTO worker_user_id, attendance_date, job_title
  FROM public.attendance AS a
  JOIN public.worker_profiles AS wp ON wp.id = a.worker_profile_id
  JOIN public.jobs AS j ON j.id = a.job_id
  WHERE a.id = NEW.attendance_id;

  IF COALESCE((
    SELECT preference.attendance_notifications
    FROM public.worker_preferences AS preference
    WHERE preference.user_id = worker_user_id
  ), TRUE) THEN
    PERFORM public.create_in_app_notification(
      worker_user_id,
      'attendance',
      'Attendance updated',
      'Attendance for ' || COALESCE(job_title, 'your job') || ' on '
        || to_char(attendance_date, 'YYYY-MM-DD') || ' was updated by your employer.',
      'attendance_audit:' || NEW.id::TEXT,
      'attendance',
      NEW.attendance_id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_employer_attendance_audit ON public.attendance_audit;
CREATE TRIGGER notify_employer_attendance_audit
  AFTER INSERT ON public.attendance_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_employer_attendance_audit();

CREATE OR REPLACE FUNCTION public.notify_security_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  alerts_enabled BOOLEAN;
  activity_title TEXT;
BEGIN
  IF NEW.event_type NOT IN ('login', 'logout', 'session_revoked', 'password_changed') THEN
    RETURN NEW;
  END IF;

  SELECT CASE
    WHEN u.role = 'WORKER' THEN COALESCE((
      SELECT preference.security_alerts
      FROM public.worker_preferences AS preference
      WHERE preference.user_id = NEW.user_id
    ), TRUE)
    WHEN u.role = 'EMPLOYER' THEN COALESCE((
      SELECT preference.security_alerts
      FROM public.employer_preferences AS preference
      WHERE preference.user_id = NEW.user_id
    ), TRUE)
    ELSE FALSE
  END
  INTO alerts_enabled
  FROM public.users AS u
  WHERE u.id = NEW.user_id;

  IF NOT COALESCE(alerts_enabled, FALSE) THEN
    RETURN NEW;
  END IF;

  activity_title := CASE NEW.event_type
    WHEN 'login' THEN 'New sign-in'
    WHEN 'logout' THEN 'Signed out'
    WHEN 'session_revoked' THEN 'Session revoked'
    WHEN 'password_changed' THEN 'Password changed'
  END;

  PERFORM public.create_in_app_notification(
    NEW.user_id,
    'security',
    activity_title,
    COALESCE(NEW.description, activity_title),
    'security:' || COALESCE(NEW.event_key, NEW.id::TEXT),
    'security_activity',
    NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_security_activity ON public.security_activity;
CREATE TRIGGER notify_security_activity
  AFTER INSERT ON public.security_activity
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_security_activity();

COMMIT;
