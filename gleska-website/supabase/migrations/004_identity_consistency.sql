-- Identity fields are optional for OAuth-only users, but unique when present.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.users ALTER COLUMN mobile DROP NOT NULL;

-- The duplicate checks intentionally abort migration instead of deleting data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users WHERE email IS NOT NULL GROUP BY lower(email) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate user emails exist; resolve them before applying 004_identity_consistency';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.users WHERE mobile IS NOT NULL GROUP BY mobile HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate user mobiles exist; resolve them before applying 004_identity_consistency';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
  ON public.users (lower(email)) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (lower(email));