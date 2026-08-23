-- Persist employer verification state without storing provider secrets or raw sensitive payloads.
CREATE TABLE IF NOT EXISTS public.employer_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  verification_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'FAILED')),
  provider_reference_id TEXT,
  failure_reason TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT employer_verifications_type_unique UNIQUE (employer_id, verification_type)
);

CREATE INDEX IF NOT EXISTS idx_employer_verifications_employer_id
  ON public.employer_verifications(employer_id);

CREATE INDEX IF NOT EXISTS idx_employer_verifications_type_status
  ON public.employer_verifications(verification_type, status);

CREATE TRIGGER update_employer_verifications_updated_at
  BEFORE UPDATE ON public.employer_verifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.employer_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employers can view their own verification records"
  ON public.employer_verifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.employer_profiles ep
      INNER JOIN public.users u ON u.id = ep.user_id
      WHERE ep.id = employer_verifications.employer_id
        AND u.id = auth.uid()
    )
  );

CREATE POLICY "Service role can do anything on employer_verifications"
  ON public.employer_verifications FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
