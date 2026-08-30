-- Create table for employer job request history (Recents)
CREATE TABLE IF NOT EXISTS public.employer_job_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_site_id UUID REFERENCES public.job_sites(id) ON DELETE SET NULL,
  site_name TEXT NOT NULL,
  description TEXT NOT NULL,
  parsed_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_employer_job_requests_user_id ON public.employer_job_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_employer_job_requests_created_at ON public.employer_job_requests(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.employer_job_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies scoped strictly to auth.uid()
DROP POLICY IF EXISTS "Employers can view own recent job requests" ON public.employer_job_requests;
CREATE POLICY "Employers can view own recent job requests"
  ON public.employer_job_requests
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Employers can insert own recent job requests" ON public.employer_job_requests;
CREATE POLICY "Employers can insert own recent job requests"
  ON public.employer_job_requests
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Employers can delete own recent job requests" ON public.employer_job_requests;
CREATE POLICY "Employers can delete own recent job requests"
  ON public.employer_job_requests
  FOR DELETE
  USING (auth.uid() = user_id);
