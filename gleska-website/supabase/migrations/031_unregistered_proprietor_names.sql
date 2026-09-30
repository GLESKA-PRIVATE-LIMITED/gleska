ALTER TABLE public.employer_onboarding_details
  ADD COLUMN IF NOT EXISTS proprietor_names JSONB;