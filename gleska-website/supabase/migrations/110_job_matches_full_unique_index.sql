-- 110_job_matches_full_unique_index.sql
--
-- Bug: job creation calls reconcile_job_candidate_pool (migration 069), whose upsert is
--   INSERT INTO public.job_matches ... ON CONFLICT (job_id, worker_profile_id) DO UPDATE ...
-- In production this raises SQLSTATE 42P10 ("there is no unique or exclusion constraint matching
-- the ON CONFLICT specification"), so matching fails with WATCHING_FAILED and candidate pools are
-- never populated.
--
-- Why: the only unique index on these columns is migration 011's PARTIAL index
--   idx_job_matches_profile_job_unique ON job_matches(job_id, worker_profile_id)
--     WHERE worker_profile_id IS NOT NULL
-- A plain ON CONFLICT (job_id, worker_profile_id) without that predicate cannot use a partial
-- index. Migration 001's full table constraint job_matches_profile_job_unique was not applied on
-- this database because job_matches already existed when 001 ran (CREATE TABLE IF NOT EXISTS skips
-- the constraint when the table is already present). So no full unique index exists here.
--
-- Fix: create a FULL (non-partial) unique index on (job_id, worker_profile_id). worker_profile_id
-- is NOT NULL, so this enforces the same uniqueness as the partial index while also matching the
-- plain ON CONFLICT. Fresh databases already get the full constraint from migration 001, so this is
-- a no-op there.
--
-- RLS impact: none.
-- Data impact: removes duplicate (job_id, worker_profile_id) rows if any exist (keeping the newest),
--   which is required before a unique index can be created; matches are meant to be unique per
--   (job, worker), so no legitimate data is lost.
-- Rollback: DROP INDEX IF EXISTS public.idx_job_matches_job_worker_unique_full;

BEGIN;

-- Defensive de-duplication (there should be none, but a missing constraint allows duplicates).
DELETE FROM public.job_matches a
USING public.job_matches b
WHERE a.job_id = b.job_id
  AND a.worker_profile_id = b.worker_profile_id
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.ctid < b.ctid));

-- Full unique index so reconcile_job_candidate_pool's ON CONFLICT (job_id, worker_profile_id) matches.
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_matches_job_worker_unique_full
  ON public.job_matches (job_id, worker_profile_id);

COMMIT;
