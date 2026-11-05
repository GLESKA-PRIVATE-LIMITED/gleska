-- 113_worker_contact_lookup.sql
--
-- Feature: the hiring agent needs to (a) send interview invites to a worker it only knows by
-- worker_profile_id, and (b) reveal a worker's contact to the employer AFTER the worker is
-- selected/hired. Both need a server-side lookup of the worker's phone and email. Worker phone
-- lives in public.users.mobile; email (when any) lives in auth.users.email. A plain query from
-- the backend cannot read auth.users, so this exposes a narrow SECURITY DEFINER function.
--
-- Security: the function returns ONLY name, mobile and email for one worker_profile_id. It is
-- revoked from PUBLIC/anon/authenticated, so the browser (anon/authenticated roles) can never
-- call it; only the backend's service_role (and the owner) can. The backend decides whether the
-- caller is entitled to the result (relay-only before hire, reveal after hire) — this function is
-- never wired to a PostgREST-reachable role, and the raw contact is returned to the employer only
-- through the hire-gated endpoint.
--
-- RLS impact: none (function, not a table).
-- Data impact: none (read-only).
-- Rollback: DROP FUNCTION IF EXISTS public.get_worker_contact_secure(uuid);

BEGIN;

CREATE OR REPLACE FUNCTION public.get_worker_contact_secure(p_worker_profile_id uuid)
RETURNS TABLE (name text, mobile text, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.name, u.mobile, au.email::text AS email
  FROM public.worker_profiles AS wp
  JOIN public.users AS u ON u.id = wp.user_id
  LEFT JOIN auth.users AS au ON au.id = wp.user_id
  WHERE wp.id = p_worker_profile_id;
$$;

REVOKE ALL ON FUNCTION public.get_worker_contact_secure(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_worker_contact_secure(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_worker_contact_secure(uuid) FROM authenticated;

COMMIT;
