BEGIN;

ALTER TABLE public.job_sites
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT,
  ADD COLUMN IF NOT EXISTS location_source TEXT;

ALTER TABLE public.job_sites
  DROP CONSTRAINT IF EXISTS job_sites_location_source_check;

ALTER TABLE public.job_sites
  ADD CONSTRAINT job_sites_location_source_check
  CHECK (location_source IS NULL OR location_source IN ('PROFILE', 'GPS', 'SEARCH', 'MAP'));

COMMIT;