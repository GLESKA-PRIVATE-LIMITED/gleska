-- Verifies migration 110: the full (non-partial) unique index on job_matches(job_id,
-- worker_profile_id) exists, so reconcile_job_candidate_pool's plain ON CONFLICT works.
-- Run after 110 is applied. Prints "ALL JOB_MATCHES UNIQUE TESTS PASSED"; any failure raises.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.expect(ok BOOLEAN, label TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'FAILED: %', label; END IF; END $$;

-- The index migration 110 creates must exist, be UNIQUE, and be NON-partial (indpred IS NULL),
-- which is what a plain ON CONFLICT (job_id, worker_profile_id) requires.
SELECT pg_temp.expect(
  EXISTS (
    SELECT 1
    FROM pg_class ix
    JOIN pg_index i ON i.indexrelid = ix.oid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'job_matches'
      AND ix.relname = 'idx_job_matches_job_worker_unique_full'
      AND i.indisunique
      AND i.indpred IS NULL
  ),
  'full non-partial unique index idx_job_matches_job_worker_unique_full exists on job_matches');

SELECT 'ALL JOB_MATCHES UNIQUE TESTS PASSED';
