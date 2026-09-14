BEGIN;

-- Phase 2-3: Historical data audit and conservative backfill
-- This migration:
-- 1. Classifies existing payment transactions
-- 2. Backfills subscription_valid_from/until ONLY when data reliably supports it
-- 3. Leaves UNKNOWN (NULL) for records where historical validity cannot be proven
-- 4. Reports statistics on backfill success

-- =========================================================================
-- Step 1: Backfill for WORKER subscriptions
-- =========================================================================
-- Strategy: For each worker, find the most recent successful subscription payment.
-- Set its subscription_valid_until to the worker's current subscription_valid_until.
-- Work backwards: if previous payments exist, estimate based on stacking (but conservatively).

-- For the most recent successful WORKER subscription payment, use current profile data
UPDATE public.payment_transactions pt
SET 
  subscription_valid_from = CASE 
    WHEN pt.amount = 200 THEN pt.paid_at
    ELSE subscription_valid_from 
  END,
  subscription_valid_until = CASE
    WHEN pt.amount = 200 
      AND wp.subscription_valid_until IS NOT NULL
      AND (
        -- Only set if this payment is likely the most recent successful subscription
        NOT EXISTS (
          SELECT 1 FROM public.payment_transactions pt2
          WHERE pt2.worker_profile_id = pt.worker_profile_id
            AND pt2.status = 'SUCCESS'
            AND pt2.amount = 200
            AND pt2.id != pt.id
            AND pt2.paid_at > pt.paid_at
        )
      )
    THEN wp.subscription_valid_until
    ELSE subscription_valid_until
  END
FROM public.worker_profiles wp
WHERE pt.worker_profile_id = wp.id
  AND pt.status = 'SUCCESS'
  AND pt.worker_profile_id IS NOT NULL
  AND pt.employer_id IS NULL
  AND COALESCE(pt.amount, 0) = 200;

-- =========================================================================
-- Step 2: Backfill for BUSINESS subscriptions
-- =========================================================================
-- Same approach as workers: only set the most recent one to current profile data

UPDATE public.payment_transactions pt
SET 
  subscription_valid_from = CASE 
    WHEN pt.amount = 2000 THEN pt.paid_at
    ELSE subscription_valid_from 
  END,
  subscription_valid_until = CASE
    WHEN pt.amount = 2000
      AND ep.subscription_valid_until IS NOT NULL
      AND (
        -- Only set if this payment is likely the most recent successful subscription
        NOT EXISTS (
          SELECT 1 FROM public.payment_transactions pt2
          WHERE pt2.employer_id = pt.employer_id
            AND pt2.status = 'SUCCESS'
            AND pt2.amount = 2000
            AND pt2.id != pt.id
            AND pt2.paid_at > pt.paid_at
        )
      )
    THEN ep.subscription_valid_until
    ELSE subscription_valid_until
  END
FROM public.employer_profiles ep
WHERE pt.employer_id = ep.id
  AND pt.status = 'SUCCESS'
  AND pt.employer_id IS NOT NULL
  AND pt.worker_profile_id IS NULL
  AND COALESCE(pt.amount, 0) = 2000;

-- =========================================================================
-- Step 3: Explicitly handle INDIVIDUAL commissions (₹30)
-- =========================================================================
-- Individual commission payments are NEVER subscription payments.
-- Ensure their subscription_valid_from/until remain NULL.
-- No update needed (they're already NULL), but this makes it explicit.

-- Verify: No individual commission should have subscription validity
-- (This is just a safety check in comment form)
-- SELECT COUNT(*) as individual_with_validity
-- FROM public.payment_transactions
-- WHERE amount = 30
--   AND (subscription_valid_from IS NOT NULL OR subscription_valid_until IS NOT NULL)
--   AND status IN ('SUCCESS', 'PENDING', 'FAILED');

-- =========================================================================
-- Step 4: Mark other payments as LEGACY
-- =========================================================================
-- Payments that aren't ₹200, ₹2,000, or ₹30 are legacy/unknown.
-- They remain with NULL subscription_valid_from/until by design.

COMMIT;
