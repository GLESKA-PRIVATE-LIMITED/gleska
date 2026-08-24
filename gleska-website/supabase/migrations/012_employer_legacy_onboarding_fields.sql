-- Preserve employer fields required by the legacy onboarding and KYC flows.
ALTER TABLE public.employer_onboarding_details
  ADD COLUMN IF NOT EXISTS business_category TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS annual_revenue TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS services_required JSONB,
  ADD COLUMN IF NOT EXISTS pan_number TEXT,
  ADD COLUMN IF NOT EXISTS cin_number TEXT,
  ADD COLUMN IF NOT EXISTS udyam_number TEXT,
  ADD COLUMN IF NOT EXISTS director_data JSONB,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_ifsc TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_holder_name TEXT,
  ADD COLUMN IF NOT EXISTS business_document_url TEXT,
  ADD COLUMN IF NOT EXISTS hiring_mode TEXT NOT NULL DEFAULT 'MANUAL';