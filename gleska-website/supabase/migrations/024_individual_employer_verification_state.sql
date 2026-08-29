BEGIN;

UPDATE public.employer_profiles
SET verification_status = 'VERIFIED'
WHERE employer_type = 'INDIVIDUAL'
  AND onboarding_status = 'COMPLETED'
  AND verification_status = 'PENDING';

COMMIT;
