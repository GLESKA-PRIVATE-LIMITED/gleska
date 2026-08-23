-- Additive onboarding state and detail fields for existing deployments.
ALTER TABLE public.worker_profiles
  ADD COLUMN IF NOT EXISTS onboarding_status onboarding_status NOT NULL DEFAULT 'NOT_STARTED';

ALTER TABLE public.employer_onboarding_details
  ADD COLUMN IF NOT EXISTS nature_of_business TEXT,
  ADD COLUMN IF NOT EXISTS number_of_proprietors INTEGER,
  ADD COLUMN IF NOT EXISTS company_email TEXT,
  ADD COLUMN IF NOT EXISTS company_phone TEXT,
  ADD COLUMN IF NOT EXISTS proprietor_name TEXT,
  ADD COLUMN IF NOT EXISTS proprietor_aadhaar TEXT,
  ADD COLUMN IF NOT EXISTS director_name TEXT,
  ADD COLUMN IF NOT EXISTS director_phone TEXT,
  ADD COLUMN IF NOT EXISTS director_email TEXT,
  ADD COLUMN IF NOT EXISTS director_address TEXT,
  ADD COLUMN IF NOT EXISTS director_aadhaar TEXT;
