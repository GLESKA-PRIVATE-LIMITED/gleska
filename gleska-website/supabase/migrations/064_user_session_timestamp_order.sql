BEGIN;

UPDATE public.user_sessions
SET last_active = first_seen
WHERE last_active < first_seen;

CREATE OR REPLACE FUNCTION public.normalize_user_session_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.first_seen := OLD.first_seen;
  ELSE
    NEW.first_seen := COALESCE(NEW.first_seen, NOW());
  END IF;

  NEW.last_active := GREATEST(
    COALESCE(NEW.last_active, NOW()),
    NEW.first_seen,
    NOW()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_user_session_timestamps ON public.user_sessions;
CREATE TRIGGER normalize_user_session_timestamps
  BEFORE INSERT OR UPDATE ON public.user_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_user_session_timestamps();

COMMIT;