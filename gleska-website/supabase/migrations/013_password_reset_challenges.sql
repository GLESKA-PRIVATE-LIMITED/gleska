CREATE TABLE IF NOT EXISTS public.password_reset_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  otp_expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  reset_authorization_hash TEXT,
  reset_expires_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep this migration compatible with the earlier email-based reset table.
ALTER TABLE public.password_reset_challenges
  ADD COLUMN IF NOT EXISTS phone TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'password_reset_challenges'
      AND column_name = 'email'
  ) THEN
    ALTER TABLE public.password_reset_challenges
      ALTER COLUMN email DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'password_reset_challenges'
      AND column_name = 'otp_hash'
  ) THEN
    ALTER TABLE public.password_reset_challenges
      ALTER COLUMN otp_hash DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'password_reset_challenges'
      AND column_name = 'email'
  ) THEN
    UPDATE public.password_reset_challenges challenge
    SET phone = users.mobile
    FROM public.users users
    WHERE challenge.phone IS NULL
      AND lower(challenge.email) = lower(users.email)
      AND users.mobile IS NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_password_reset_challenges_phone ON public.password_reset_challenges (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_challenges_authorization ON public.password_reset_challenges (reset_authorization_hash);
ALTER TABLE public.password_reset_challenges ENABLE ROW LEVEL SECURITY;