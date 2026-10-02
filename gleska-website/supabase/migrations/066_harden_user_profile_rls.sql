BEGIN;

REVOKE UPDATE ON TABLE
  public.users,
  public.worker_profiles,
  public.employer_profiles
FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  table_name TEXT;
  column_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users', 'worker_profiles', 'employer_profiles'] LOOP
    FOR column_name IN
      SELECT attribute.attname
      FROM pg_attribute AS attribute
      WHERE attribute.attrelid = format('public.%I', table_name)::regclass
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    LOOP
      EXECUTE format(
        'REVOKE UPDATE (%I) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        column_name,
        table_name
      );
    END LOOP;
  END LOOP;
END
$$;

GRANT UPDATE ON TABLE
  public.users,
  public.worker_profiles,
  public.employer_profiles
TO service_role;

DROP POLICY IF EXISTS "Users can update their own record" ON public.users;
DROP POLICY IF EXISTS "Workers can update their own profile" ON public.worker_profiles;
DROP POLICY IF EXISTS "Employers can update their own profile" ON public.employer_profiles;

COMMIT;
