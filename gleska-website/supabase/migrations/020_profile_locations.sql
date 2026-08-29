BEGIN;

ALTER TABLE public.worker_profiles
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT,
  ADD COLUMN IF NOT EXISTS location_source TEXT,
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

ALTER TABLE public.worker_profiles
  DROP CONSTRAINT IF EXISTS worker_profiles_location_source_check;

ALTER TABLE public.worker_profiles
  ADD CONSTRAINT worker_profiles_location_source_check
  CHECK (location_source IS NULL OR location_source IN ('PROFILE', 'GPS', 'SEARCH', 'MAP'));

COMMIT;