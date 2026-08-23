-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_onboarding_details ENABLE ROW LEVEL SECURITY;

-- RLS Policies for public.users
CREATE POLICY "Users can view their own record"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own record"
  ON public.users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow service role to do anything (for backend)
CREATE POLICY "Service role can do anything on users"
  ON public.users FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- RLS Policies for public.worker_profiles
CREATE POLICY "Workers can view their own profile"
  ON public.worker_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE public.users.id = auth.uid()
      AND public.users.id = worker_profiles.user_id
    )
  );

CREATE POLICY "Workers can update their own profile"
  ON public.worker_profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE public.users.id = auth.uid()
      AND public.users.id = worker_profiles.user_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE public.users.id = auth.uid()
      AND public.users.id = worker_profiles.user_id
    )
  );

-- Allow service role to do anything (for backend)
CREATE POLICY "Service role can do anything on worker_profiles"
  ON public.worker_profiles FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- RLS Policies for public.employer_profiles
CREATE POLICY "Employers can view their own profile"
  ON public.employer_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE public.users.id = auth.uid()
      AND public.users.id = employer_profiles.user_id
    )
  );

CREATE POLICY "Employers can update their own profile"
  ON public.employer_profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE public.users.id = auth.uid()
      AND public.users.id = employer_profiles.user_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE public.users.id = auth.uid()
      AND public.users.id = employer_profiles.user_id
    )
  );

-- Allow service role to do anything (for backend)
CREATE POLICY "Service role can do anything on employer_profiles"
  ON public.employer_profiles FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- RLS Policies for public.employer_onboarding_details
CREATE POLICY "Employers can view their own onboarding details"
  ON public.employer_onboarding_details FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      INNER JOIN public.users u ON u.id = ep.user_id
      WHERE u.id = auth.uid()
      AND ep.id = employer_onboarding_details.employer_id
    )
  );

CREATE POLICY "Employers can update their own onboarding details"
  ON public.employer_onboarding_details FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      INNER JOIN public.users u ON u.id = ep.user_id
      WHERE u.id = auth.uid()
      AND ep.id = employer_onboarding_details.employer_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      INNER JOIN public.users u ON u.id = ep.user_id
      WHERE u.id = auth.uid()
      AND ep.id = employer_onboarding_details.employer_id
    )
  );

-- Allow service role to do anything (for backend)
CREATE POLICY "Service role can do anything on employer_onboarding_details"
  ON public.employer_onboarding_details FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
