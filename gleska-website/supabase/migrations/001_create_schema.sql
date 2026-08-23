-- Create ENUM types for roles and status fields when they do not exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE user_role AS ENUM ('WORKER', 'EMPLOYER', 'ADMIN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'worker_availability' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE worker_availability AS ENUM ('AVAILABLE', 'ON_JOB', 'OFFLINE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employer_type' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE employer_type AS ENUM ('REGISTERED_INDUSTRY', 'REGISTERED_BUSINESS', 'UNREGISTERED_BUSINESS', 'INDIVIDUAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'onboarding_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE onboarding_status AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE verification_status AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
  END IF;
END $$;

-- Create the public.users table
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mobile TEXT UNIQUE NOT NULL,
  role user_role NOT NULL,
  is_mobile_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create the public.worker_profiles table
CREATE TABLE IF NOT EXISTS public.worker_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trade_id UUID,
  experience_years INTEGER,
  expected_daily_wage NUMERIC,
  availability_status worker_availability DEFAULT 'OFFLINE',
  city TEXT,
  state TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  profile_completed BOOLEAN DEFAULT FALSE,
  onboarding_status onboarding_status DEFAULT 'NOT_STARTED',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create the public.employer_profiles table
CREATE TABLE IF NOT EXISTS public.employer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  employer_type employer_type,
  onboarding_status onboarding_status DEFAULT 'NOT_STARTED',
  verification_status verification_status DEFAULT 'PENDING',
  contact_person_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create the public.employer_onboarding_details table
CREATE TABLE IF NOT EXISTS public.employer_onboarding_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID UNIQUE NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  business_name TEXT,
  business_type TEXT,
  industry_category TEXT,
  industry_type TEXT,
  registered_address TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  gstin TEXT,
  registration_number TEXT,
  work_location TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_users_mobile ON public.users(mobile);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_user_id ON public.worker_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_employer_profiles_user_id ON public.employer_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_employer_onboarding_employer_id ON public.employer_onboarding_details(employer_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at columns
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_worker_profiles_updated_at ON public.worker_profiles;
CREATE TRIGGER update_worker_profiles_updated_at BEFORE UPDATE ON public.worker_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_employer_profiles_updated_at ON public.employer_profiles;
CREATE TRIGGER update_employer_profiles_updated_at BEFORE UPDATE ON public.employer_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_employer_onboarding_details_updated_at ON public.employer_onboarding_details;
CREATE TRIGGER update_employer_onboarding_details_updated_at BEFORE UPDATE ON public.employer_onboarding_details
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
