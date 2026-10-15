BEGIN;

CREATE OR REPLACE FUNCTION public.admin_financial_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ADMIN_FINANCIAL_AUTHORIZATION_FAILED'
      USING ERRCODE = '42501';
  END IF;

  WITH paid_by_invoice AS (
    SELECT invoice_id, SUM(amount) AS paid_amount
    FROM public.financial_invoice_payments
    GROUP BY invoice_id
  ),
  generated_invoices AS (
    SELECT
      invoice.currency,
      invoice.total,
      invoice.due_date,
      GREATEST(invoice.total - COALESCE(payment.paid_amount, 0), 0) AS outstanding
    FROM public.financial_invoices invoice
    LEFT JOIN paid_by_invoice payment ON payment.invoice_id = invoice.id
    WHERE invoice.status = 'GENERATED'
  ),
  invoiced_totals AS (
    SELECT currency, SUM(total) AS amount
    FROM generated_invoices
    GROUP BY currency
  ),
  receivable_totals AS (
    SELECT currency, SUM(outstanding) AS amount
    FROM generated_invoices
    WHERE outstanding > 0
    GROUP BY currency
  ),
  overdue_totals AS (
    SELECT currency, SUM(outstanding) AS amount
    FROM generated_invoices
    WHERE outstanding > 0 AND due_date < CURRENT_DATE
    GROUP BY currency
  ),
  payment_totals AS (
    SELECT invoice.currency, SUM(payment.amount) AS amount
    FROM public.financial_invoice_payments payment
    JOIN public.financial_invoices invoice ON invoice.id = payment.invoice_id
    GROUP BY invoice.currency
  ),
  vendor_bill_totals AS (
    SELECT currency, SUM(total) AS amount
    FROM public.financial_vendor_bills
    WHERE currency IS NOT NULL AND total IS NOT NULL
    GROUP BY currency
  )
  SELECT jsonb_build_object(
    'generated_invoice_count', (
      SELECT COUNT(*)::INTEGER FROM generated_invoices
    ),
    'invoiced_by_currency', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY currency)
      FROM invoiced_totals
    ), '[]'::JSONB),
    'outstanding_invoice_count', (
      SELECT COUNT(*)::INTEGER FROM generated_invoices WHERE outstanding > 0
    ),
    'outstanding_by_currency', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY currency)
      FROM receivable_totals
    ), '[]'::JSONB),
    'overdue_invoice_count', (
      SELECT COUNT(*)::INTEGER
      FROM generated_invoices
      WHERE outstanding > 0 AND due_date < CURRENT_DATE
    ),
    'overdue_by_currency', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY currency)
      FROM overdue_totals
    ), '[]'::JSONB),
    'payment_count', (
      SELECT COUNT(*)::INTEGER FROM public.financial_invoice_payments
    ),
    'payments_by_currency', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY currency)
      FROM payment_totals
    ), '[]'::JSONB),
    'active_vendor_count', (
      SELECT COUNT(*)::INTEGER FROM public.financial_vendors WHERE is_active
    ),
    'vendor_bill_count', (
      SELECT COUNT(*)::INTEGER FROM public.financial_vendor_bills
    ),
    'vendor_bill_totals_by_currency', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY currency)
      FROM vendor_bill_totals
    ), '[]'::JSONB),
    'audit_runs_available', TRUE,
    'audit_run_count', (
      SELECT COUNT(*)::INTEGER FROM public.financial_audit_runs
    ),
    'completed_audit_run_count', (
      SELECT COUNT(*)::INTEGER FROM public.financial_audit_runs WHERE status = 'COMPLETED'
    ),
    'failed_audit_run_count', (
      SELECT COUNT(*)::INTEGER FROM public.financial_audit_runs WHERE status = 'FAILED'
    ),
    'running_audit_run_count', (
      SELECT COUNT(*)::INTEGER FROM public.financial_audit_runs WHERE status = 'RUNNING'
    ),
    'passed_check_count', (
      SELECT COALESCE(SUM(passed_checks), 0)::INTEGER
      FROM public.financial_audit_runs
    ),
    'failed_check_count', (
      SELECT COALESCE(SUM(failed_checks), 0)::INTEGER
      FROM public.financial_audit_runs
    ),
    'finding_count', (
      SELECT COALESCE(SUM(jsonb_array_length(findings)), 0)::INTEGER
      FROM public.financial_audit_check_results
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_financial_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_financial_overview() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_financial_invoice_balances(p_invoice_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ADMIN_FINANCIAL_AUTHORIZATION_FAILED'
      USING ERRCODE = '42501';
  END IF;

  WITH requested AS (
    SELECT DISTINCT unnest(COALESCE(p_invoice_ids, ARRAY[]::UUID[])) AS invoice_id
  ),
  payments AS (
    SELECT invoice_id, SUM(amount) AS paid_amount
    FROM public.financial_invoice_payments
    WHERE invoice_id IN (SELECT invoice_id FROM requested)
    GROUP BY invoice_id
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'invoice_id', invoice.id,
      'paid_amount', COALESCE(payment.paid_amount, 0),
      'outstanding_amount', GREATEST(invoice.total - COALESCE(payment.paid_amount, 0), 0),
      'is_overdue',
        GREATEST(invoice.total - COALESCE(payment.paid_amount, 0), 0) > 0
        AND invoice.due_date < CURRENT_DATE
    ) ORDER BY invoice.id),
    '[]'::JSONB
  )
  INTO v_result
  FROM public.financial_invoices invoice
  LEFT JOIN payments payment ON payment.invoice_id = invoice.id
  WHERE invoice.id IN (SELECT invoice_id FROM requested)
    AND invoice.status = 'GENERATED';

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_financial_invoice_balances(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_financial_invoice_balances(UUID[]) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_financial_vendor_stats(p_vendor_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ADMIN_FINANCIAL_AUTHORIZATION_FAILED'
      USING ERRCODE = '42501';
  END IF;

  WITH requested AS (
    SELECT DISTINCT unnest(COALESCE(p_vendor_ids, ARRAY[]::UUID[])) AS vendor_id
  ),
  bill_counts AS (
    SELECT bill.vendor_id, COUNT(*)::INTEGER AS bill_count
    FROM public.financial_vendor_bills bill
    WHERE bill.vendor_id IN (SELECT vendor_id FROM requested)
    GROUP BY bill.vendor_id
  ),
  bill_totals AS (
    SELECT bill.vendor_id, bill.currency, SUM(bill.total) AS amount
    FROM public.financial_vendor_bills bill
    WHERE bill.vendor_id IN (SELECT vendor_id FROM requested)
      AND bill.currency IS NOT NULL
      AND bill.total IS NOT NULL
    GROUP BY bill.vendor_id, bill.currency
  ),
  totals_by_vendor AS (
    SELECT vendor_id, jsonb_agg(
      jsonb_build_object('currency', currency, 'amount', amount) ORDER BY currency
    ) AS totals
    FROM bill_totals
    GROUP BY vendor_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'vendor_id', requested.vendor_id,
    'bill_count', COALESCE(bill_counts.bill_count, 0),
    'bill_totals_by_currency', COALESCE(totals_by_vendor.totals, '[]'::JSONB)
  ) ORDER BY requested.vendor_id), '[]'::JSONB)
  INTO v_result
  FROM requested
  LEFT JOIN bill_counts ON bill_counts.vendor_id = requested.vendor_id
  LEFT JOIN totals_by_vendor ON totals_by_vendor.vendor_id = requested.vendor_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_financial_vendor_stats(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_financial_vendor_stats(UUID[]) TO service_role;

COMMIT;
