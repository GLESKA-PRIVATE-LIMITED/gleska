BEGIN;

-- GPS remains usable when Nominatim cannot resolve an address.
ALTER TABLE public.worker_current_locations
  ALTER COLUMN address DROP NOT NULL;

ALTER TABLE public.worker_current_locations
  DROP CONSTRAINT IF EXISTS worker_current_locations_address_check;

COMMIT;
