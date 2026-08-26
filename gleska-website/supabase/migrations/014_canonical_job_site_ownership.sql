-- Move legacy job-site ownership to employer_profiles without guessing identities.
-- Legacy rows without an unambiguous supabase_auth_id mapping are preserved. The
-- NOT VALID FK blocks new legacy references while allowing those rows to remain.

BEGIN;

DO $$
DECLARE
  column_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO column_type
  FROM pg_attribute AS a
  JOIN pg_class AS c ON c.oid = a.attrelid
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'job_sites'
    AND a.attname = 'employer_id'
    AND NOT a.attisdropped;

  IF column_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'job_sites.employer_id must remain uuid; found %', column_type;
  END IF;
END $$;

-- A mapping is valid only when the legacy row carries an immutable auth identity
-- that resolves to exactly one canonical employer profile.
CREATE TEMP TABLE legacy_employer_map ON COMMIT DROP AS
SELECT DISTINCT
  legacy.id AS legacy_employer_id,
  profile.id AS canonical_employer_id
FROM public.employers AS legacy
JOIN public.users AS app_user
  ON app_user.id::text = legacy.supabase_auth_id::text
JOIN public.employer_profiles AS profile
  ON profile.user_id = app_user.id;

-- Remove any employer_id FK on the active job tables, regardless of its old name.
DO $$
DECLARE
  constraint_record record;
BEGIN
  FOR constraint_record IN
    SELECT
      child.relname AS table_name,
      constraint_name.name AS constraint_name
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS child ON child.oid = constraint_row.conrelid
    JOIN pg_attribute AS child_column
      ON child_column.attrelid = child.oid
     AND child_column.attnum = ANY(constraint_row.conkey)
    JOIN pg_class AS parent ON parent.oid = constraint_row.confrelid
    JOIN pg_namespace AS child_schema ON child_schema.oid = child.relnamespace
    JOIN pg_namespace AS parent_schema ON parent_schema.oid = parent.relnamespace
    JOIN LATERAL (SELECT constraint_row.conname AS name) AS constraint_name ON TRUE
    WHERE constraint_row.contype = 'f'
      AND child_schema.nspname = 'public'
      AND parent_schema.nspname = 'public'
      AND child.relname IN ('job_sites', 'jobs')
      AND child_column.attname = 'employer_id'
      AND parent.relname = 'employers'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT %I',
      constraint_record.table_name,
      constraint_record.constraint_name
    );
  END LOOP;
END $$;

-- Sites are authoritative for the ownership of their jobs. Migrate both sides
-- together wherever the legacy identity mapping is provable.
UPDATE public.job_sites AS site
SET employer_id = mapping.canonical_employer_id
FROM legacy_employer_map AS mapping
WHERE site.employer_id = mapping.legacy_employer_id;

UPDATE public.jobs AS job
SET employer_id = site.employer_id
FROM public.job_sites AS site
WHERE site.id = job.job_site_id
  AND job.employer_id IS DISTINCT FROM site.employer_id;

-- New writes must use the canonical table. Existing unmapped legacy rows are
-- intentionally retained and can be identified with the audit query below.
ALTER TABLE public.job_sites
  DROP CONSTRAINT IF EXISTS job_sites_employer_id_fkey;
ALTER TABLE public.job_sites
  ADD CONSTRAINT job_sites_employer_id_fkey
  FOREIGN KEY (employer_id)
  REFERENCES public.employer_profiles(id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_employer_id_fkey;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_employer_id_fkey
  FOREIGN KEY (employer_id)
  REFERENCES public.employer_profiles(id)
  ON DELETE CASCADE
  NOT VALID;

COMMIT;

-- Run after applying the migration to report preserved legacy ownership.
-- These rows cannot be validated until a manual identity mapping is established.
SELECT
  site.id AS job_site_id,
  site.employer_id AS unresolved_legacy_employer_id,
  COUNT(job.id)::integer AS associated_job_count
FROM public.job_sites AS site
LEFT JOIN public.jobs AS job ON job.job_site_id = site.id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.employer_profiles AS profile
  WHERE profile.id = site.employer_id
)
GROUP BY site.id, site.employer_id
ORDER BY site.id;
