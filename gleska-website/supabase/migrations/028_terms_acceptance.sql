-- Migration 028: Add terms_accepted and terms_accepted_at columns to public.users
BEGIN;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- Create index for terms_accepted for compliance auditing
CREATE INDEX IF NOT EXISTS idx_users_terms_accepted ON public.users(terms_accepted);

COMMIT;
