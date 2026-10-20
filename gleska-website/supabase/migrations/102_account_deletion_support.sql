-- Migration 102: Account Deletion Support and Integrity
-- Provides an atomic database procedure to safely delete or anonymize user records across all domains,
-- while updating foreign key constraints so that user deletion is never blocked by audit/session logs.

BEGIN;

-- 1. Ensure attendance_audit foreign key does not block user deletion
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'attendance_audit_actor_user_id_fkey'
  ) THEN
    ALTER TABLE public.attendance_audit DROP CONSTRAINT attendance_audit_actor_user_id_fkey;
    ALTER TABLE public.attendance_audit ALTER COLUMN actor_user_id DROP NOT NULL;
    ALTER TABLE public.attendance_audit 
      ADD CONSTRAINT attendance_audit_actor_user_id_fkey 
      FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Ensure supplier_company_memberships cascades or drops cleanly
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'supplier_company_memberships_user_id_fkey'
  ) THEN
    ALTER TABLE public.supplier_company_memberships DROP CONSTRAINT supplier_company_memberships_user_id_fkey;
    ALTER TABLE public.supplier_company_memberships 
      ADD CONSTRAINT supplier_company_memberships_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Stored Procedure: execute_user_account_deletion
CREATE OR REPLACE FUNCTION public.execute_user_account_deletion(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role TEXT;
  v_worker_profile_id UUID;
  v_employer_profile_id UUID;
  v_admin_count INT;
  v_deleted_email TEXT;
BEGIN
  -- Verify user exists
  SELECT role, email INTO v_role, v_deleted_email
  FROM public.users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  -- Admin safety check: Ensure at least one other active admin remains
  IF v_role = 'ADMIN' THEN
    SELECT COUNT(*) INTO v_admin_count
    FROM public.users
    WHERE role = 'ADMIN' AND is_active = TRUE AND id <> p_user_id;

    IF v_admin_count < 1 THEN
      RAISE EXCEPTION 'CANNOT_DELETE_SOLE_ADMIN: At least one other active system administrator must remain.';
    END IF;
  END IF;

  -- 1. Sessions, Security activities, Notifications
  DELETE FROM public.user_sessions WHERE user_id = p_user_id;
  DELETE FROM public.security_activity WHERE user_id = p_user_id;
  DELETE FROM public.in_app_notifications WHERE user_id = p_user_id;

  -- 2. Assistant & Conversations
  DELETE FROM public.assistant_conversations WHERE user_id = p_user_id;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'financial_agent_conversations') THEN
    DELETE FROM public.financial_agent_conversations WHERE user_id = p_user_id;
  END IF;

  -- 3. Procurement & Supplier preferences / memberships
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'procurement_workspace_preference') THEN
    DELETE FROM public.procurement_workspace_preference WHERE user_id = p_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'procurement_conversation_archive') THEN
    DELETE FROM public.procurement_conversation_archive WHERE user_id = p_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'supplier_user_preferences') THEN
    DELETE FROM public.supplier_user_preferences WHERE user_id = p_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'supplier_company_memberships') THEN
    DELETE FROM public.supplier_company_memberships WHERE user_id = p_user_id;
  END IF;

  -- 4. Worker Profile & Dependent data
  SELECT id INTO v_worker_profile_id FROM public.worker_profiles WHERE user_id = p_user_id;
  IF v_worker_profile_id IS NOT NULL THEN
    -- Documents, Locations, Subscriptions, Preferences, Matches
    DELETE FROM public.worker_documents WHERE worker_profile_id = v_worker_profile_id;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'worker_current_locations') THEN
      DELETE FROM public.worker_current_locations WHERE worker_profile_id = v_worker_profile_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'worker_profile_locations') THEN
      DELETE FROM public.worker_profile_locations WHERE worker_profile_id = v_worker_profile_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'worker_preferences') THEN
      DELETE FROM public.worker_preferences WHERE worker_profile_id = v_worker_profile_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'worker_subscriptions') THEN
      DELETE FROM public.worker_subscriptions WHERE worker_profile_id = v_worker_profile_id;
    END IF;
    DELETE FROM public.job_matches WHERE worker_profile_id = v_worker_profile_id;
    DELETE FROM public.worker_profiles WHERE id = v_worker_profile_id;
  END IF;

  -- 5. Employer Profile & Dependent data
  SELECT id INTO v_employer_profile_id FROM public.employer_profiles WHERE user_id = p_user_id;
  IF v_employer_profile_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employer_onboarding_details') THEN
      DELETE FROM public.employer_onboarding_details WHERE employer_id = v_employer_profile_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employer_job_request_history') THEN
      DELETE FROM public.employer_job_request_history WHERE employer_id = v_employer_profile_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employer_preferences') THEN
      DELETE FROM public.employer_preferences WHERE employer_id = v_employer_profile_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employer_verifications') THEN
      DELETE FROM public.employer_verifications WHERE employer_id = v_employer_profile_id;
    END IF;
    DELETE FROM public.job_matches WHERE job_id IN (SELECT id FROM public.jobs WHERE employer_id = v_employer_profile_id);
    DELETE FROM public.jobs WHERE employer_id = v_employer_profile_id;
    DELETE FROM public.job_sites WHERE employer_id = v_employer_profile_id;
    DELETE FROM public.employer_profiles WHERE id = v_employer_profile_id;
  END IF;

  -- 6. Disassociate/Anonymize references in audit tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'attendance_audit') THEN
    UPDATE public.attendance_audit SET actor_user_id = NULL WHERE actor_user_id = p_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'financial_scan_and_central_audit') THEN
    UPDATE public.financial_scan_and_central_audit SET actor_user_id = NULL WHERE actor_user_id = p_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'procurement_purchase_orders') THEN
    UPDATE public.procurement_purchase_orders SET buyer_user_id = NULL WHERE buyer_user_id = p_user_id;
  END IF;

  -- 7. Delete the public.users record
  DELETE FROM public.users WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'role', v_role,
    'message', 'User account and associated records deleted successfully.'
  );
END;
$$;

-- Grant execution to authenticated users and service_role
GRANT EXECUTE ON FUNCTION public.execute_user_account_deletion(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_user_account_deletion(UUID) TO service_role;

COMMIT;
