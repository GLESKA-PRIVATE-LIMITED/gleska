-- Keep the persisted verification state aligned with the application state machine.
ALTER TABLE public.employer_verifications
  DROP CONSTRAINT IF EXISTS employer_verifications_status_check;

ALTER TABLE public.employer_verifications
  ADD CONSTRAINT employer_verifications_status_check
  CHECK (status IN ('PENDING', 'VERIFIED', 'FAILED', 'NOT_CONFIGURED'));