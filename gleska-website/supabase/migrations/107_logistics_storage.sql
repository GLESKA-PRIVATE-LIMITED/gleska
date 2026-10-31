-- Logistics agent: persist vehicle listings (lent) and rental requests (obtained) server-side.
-- Previously these lived only in the browser's localStorage (docs/company-brain/DATA_SOURCE_INVENTORY.md).
--
-- RLS impact: two new tables, RLS enabled. Employers may SELECT their own rows; all writes go
--   through the backend (service_role), which filters by the caller's employer profile.
-- Data impact: additive. Browser data is imported once by the website through POST /logistics/import.
-- Rollback: drop both tables (the website keeps working from an empty server list; localStorage
--   copies are removed only after a successful import).

BEGIN;

CREATE TABLE IF NOT EXISTS public.logistics_vehicle_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (char_length(category) BETWEEN 1 AND 80),
  vehicle_type TEXT NOT NULL CHECK (char_length(vehicle_type) BETWEEN 1 AND 80),
  registration_number TEXT NOT NULL CHECK (char_length(registration_number) BETWEEN 1 AND 20),
  make_model TEXT CHECK (char_length(make_model) <= 120),
  model_year INTEGER CHECK (model_year BETWEEN 1950 AND 2100),
  capacity_tons NUMERIC(10,2) CHECK (capacity_tons >= 0),
  dimensions TEXT CHECK (char_length(dimensions) <= 120),
  fuel_type TEXT CHECK (char_length(fuel_type) <= 40),
  ownership TEXT CHECK (char_length(ownership) <= 60),
  location TEXT CHECK (char_length(location) <= 200),
  service_area TEXT CHECK (char_length(service_area) <= 300),
  available_from DATE,
  available_until DATE,
  price_amount NUMERIC(14,2) CHECK (price_amount >= 0),
  price_unit TEXT NOT NULL CHECK (price_unit IN ('per day', 'per trip', 'per km', 'per ton')),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  driver_available TEXT CHECK (driver_available IN ('With Driver', 'Without Driver', 'On Request')),
  permitted_usage TEXT CHECK (char_length(permitted_usage) <= 300),
  contact_name TEXT CHECK (char_length(contact_name) <= 120),
  contact_phone TEXT CHECK (char_length(contact_phone) <= 20),
  contact_email TEXT CHECK (char_length(contact_email) <= 254),
  notes TEXT CHECK (char_length(notes) <= 2000),
  documents JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(documents) = 'object'),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISPATCHED', 'MAINTENANCE', 'ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT logistics_listing_dates CHECK (available_until IS NULL OR available_from IS NULL OR available_until >= available_from)
);
CREATE INDEX IF NOT EXISTS idx_logistics_listings_employer ON public.logistics_vehicle_listings(employer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.logistics_rental_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  vehicle_ref TEXT CHECK (char_length(vehicle_ref) <= 100),
  vehicle_title TEXT CHECK (char_length(vehicle_title) <= 200),
  vehicle_registration TEXT CHECK (char_length(vehicle_registration) <= 20),
  category TEXT CHECK (char_length(category) <= 80),
  source_location TEXT NOT NULL CHECK (char_length(source_location) BETWEEN 1 AND 200),
  destination_location TEXT NOT NULL CHECK (char_length(destination_location) BETWEEN 1 AND 200),
  pickup_date DATE,
  rental_duration TEXT CHECK (char_length(rental_duration) <= 60),
  offered_price NUMERIC(14,2) CHECK (offered_price >= 0),
  price_unit TEXT CHECK (price_unit IN ('per day', 'per trip', 'per km', 'per ton')),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  driver_required BOOLEAN NOT NULL DEFAULT FALSE,
  cargo_type TEXT CHECK (char_length(cargo_type) <= 200),
  instructions TEXT CHECK (char_length(instructions) <= 2000),
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'CONFIRMED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_logistics_requests_employer ON public.logistics_rental_requests(employer_id, created_at DESC);

ALTER TABLE public.logistics_vehicle_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_rental_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.logistics_vehicle_listings, public.logistics_rental_requests FROM anon, authenticated;
GRANT SELECT ON public.logistics_vehicle_listings, public.logistics_rental_requests TO authenticated;
GRANT ALL ON public.logistics_vehicle_listings, public.logistics_rental_requests TO service_role;

DROP POLICY IF EXISTS "Employers read own vehicle listings" ON public.logistics_vehicle_listings;
CREATE POLICY "Employers read own vehicle listings" ON public.logistics_vehicle_listings
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.employer_profiles e WHERE e.id = employer_id AND e.user_id = auth.uid()));
DROP POLICY IF EXISTS "Employers read own rental requests" ON public.logistics_rental_requests;
CREATE POLICY "Employers read own rental requests" ON public.logistics_rental_requests
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.employer_profiles e WHERE e.id = employer_id AND e.user_id = auth.uid()));

COMMIT;
