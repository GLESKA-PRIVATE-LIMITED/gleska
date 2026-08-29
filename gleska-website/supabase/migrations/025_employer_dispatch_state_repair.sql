BEGIN;

ALTER TABLE public.employer_profiles
  ADD COLUMN IF NOT EXISTS has_availed_free_dispatch BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
