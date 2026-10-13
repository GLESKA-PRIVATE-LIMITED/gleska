BEGIN;

CREATE TABLE IF NOT EXISTS public.financial_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  employer_id UUID NOT NULL UNIQUE REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  base_currency TEXT NOT NULL DEFAULT 'INR'
    CHECK (base_currency IN ('INR', 'USD', 'EUR')),
  tax_identifier TEXT NOT NULL DEFAULT '' CHECK (char_length(tax_identifier) <= 64),
  auto_reconcile_incoming_bills BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_settings_user_employer_unique UNIQUE (user_id, employer_id)
);

CREATE TABLE IF NOT EXISTS public.financial_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL CHECK (char_length(invoice_number) BETWEEN 1 AND 120),
  client_name TEXT NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 240),
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL CHECK (due_date >= issue_date),
  payment_terms_notes TEXT NOT NULL DEFAULT '' CHECK (char_length(payment_terms_notes) <= 2000),
  currency TEXT NOT NULL CHECK (currency IN ('INR', 'USD', 'EUR')),
  tax_rate NUMERIC(7, 4) NOT NULL CHECK (tax_rate >= 0 AND tax_rate <= 100),
  subtotal NUMERIC(14, 2) NOT NULL CHECK (subtotal >= 0),
  tax_amount NUMERIC(14, 2) NOT NULL CHECK (tax_amount >= 0),
  total NUMERIC(14, 2) NOT NULL CHECK (total >= 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'GENERATED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_invoices_number_per_employer UNIQUE (employer_id, invoice_number),
  CONSTRAINT financial_invoices_id_owner_unique UNIQUE (id, user_id, employer_id),
  CONSTRAINT financial_invoices_total_consistent CHECK (total = subtotal + tax_amount)
);

CREATE TABLE IF NOT EXISTS public.financial_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
  quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(14, 2) NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_invoice_items_invoice_owner_fk
    FOREIGN KEY (invoice_id, user_id, employer_id)
    REFERENCES public.financial_invoices(id, user_id, employer_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_financial_settings_user_id
  ON public.financial_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_financial_invoices_owner_issue_date
  ON public.financial_invoices(user_id, employer_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_invoices_owner_status
  ON public.financial_invoices(user_id, employer_id, status);
CREATE INDEX IF NOT EXISTS idx_financial_invoice_items_invoice_id
  ON public.financial_invoice_items(user_id, employer_id, invoice_id);

DROP TRIGGER IF EXISTS update_financial_settings_updated_at ON public.financial_settings;
CREATE TRIGGER update_financial_settings_updated_at
  BEFORE UPDATE ON public.financial_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_financial_invoices_updated_at ON public.financial_invoices;
CREATE TRIGGER update_financial_invoices_updated_at
  BEFORE UPDATE ON public.financial_invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.financial_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employers can access their financial settings"
  ON public.financial_settings FOR ALL
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_settings.employer_id
        AND ep.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_settings.employer_id
        AND ep.user_id = auth.uid()
    )
  );
CREATE POLICY "Service role can access financial settings"
  ON public.financial_settings FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Employers can access their financial invoices"
  ON public.financial_invoices FOR ALL
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_invoices.employer_id
        AND ep.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_invoices.employer_id
        AND ep.user_id = auth.uid()
    )
  );
CREATE POLICY "Service role can access financial invoices"
  ON public.financial_invoices FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Employers can access their financial invoice items"
  ON public.financial_invoice_items FOR ALL
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_invoice_items.employer_id
        AND ep.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_invoice_items.employer_id
        AND ep.user_id = auth.uid()
    )
  );
CREATE POLICY "Service role can access financial invoice items"
  ON public.financial_invoice_items FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMIT;
