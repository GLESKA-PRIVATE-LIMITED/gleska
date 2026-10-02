BEGIN;

ALTER TABLE public.worker_current_locations
  ADD COLUMN IF NOT EXISTS location_source TEXT NOT NULL DEFAULT 'GPS';

ALTER TABLE public.worker_current_locations
  DROP CONSTRAINT IF EXISTS worker_current_locations_location_source_check;

ALTER TABLE public.worker_current_locations
  ADD CONSTRAINT worker_current_locations_location_source_check
  CHECK (location_source IN ('GPS', 'PROFILE'));

COMMIT;
