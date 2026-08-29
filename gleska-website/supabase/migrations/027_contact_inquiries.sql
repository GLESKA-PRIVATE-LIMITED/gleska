-- Create contact inquiries table for business inquiry submissions
BEGIN;

CREATE TABLE IF NOT EXISTS public.contact_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company TEXT,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  email_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for email lookups
CREATE INDEX IF NOT EXISTS idx_contact_inquiries_email ON public.contact_inquiries(email);

-- Create index for created_at for sorting/filtering
CREATE INDEX IF NOT EXISTS idx_contact_inquiries_created_at ON public.contact_inquiries(created_at DESC);

-- Create index for email_status for filtering failed deliveries
CREATE INDEX IF NOT EXISTS idx_contact_inquiries_email_status ON public.contact_inquiries(email_status);

-- Create updated_at trigger if not exists
DROP TRIGGER IF EXISTS update_contact_inquiries_updated_at ON public.contact_inquiries;

CREATE TRIGGER update_contact_inquiries_updated_at
BEFORE UPDATE ON public.contact_inquiries
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

COMMIT;
