-- Persist safe Cashfree verification metadata without storing credentials or raw provider payloads.
ALTER TABLE public.employer_verifications
  ADD COLUMN IF NOT EXISTS provider TEXT;

ALTER TABLE public.employer_verifications
  ADD COLUMN IF NOT EXISTS provider_metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_employer_verifications_provider
  ON public.employer_verifications(provider);