BEGIN;

CREATE TABLE public.financial_audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_checks INTEGER NOT NULL DEFAULT 0 CHECK (total_checks >= 0),
  passed_checks INTEGER NOT NULL DEFAULT 0 CHECK (passed_checks >= 0),
  failed_checks INTEGER NOT NULL DEFAULT 0 CHECK (failed_checks >= 0),
  not_applicable_checks INTEGER NOT NULL DEFAULT 0 CHECK (not_applicable_checks >= 0),
  pass_rate NUMERIC(5, 2) CHECK (pass_rate IS NULL OR pass_rate BETWEEN 0 AND 100),
  summary JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(summary) = 'object'),
  error_message TEXT CHECK (error_message IS NULL OR char_length(error_message) <= 1000),
  CONSTRAINT financial_audit_runs_id_owner_unique UNIQUE (id, user_id, employer_id),
  CONSTRAINT financial_audit_runs_employer_idempotency_unique UNIQUE (employer_id, idempotency_key),
  CONSTRAINT financial_audit_runs_completion_state_check CHECK (
    (status = 'RUNNING' AND completed_at IS NULL)
    OR (status IN ('COMPLETED', 'FAILED') AND completed_at IS NOT NULL)
  ),
  CONSTRAINT financial_audit_runs_counts_consistent CHECK (
    passed_checks + failed_checks + not_applicable_checks = total_checks
  )
);

CREATE UNIQUE INDEX financial_audit_runs_one_running_per_employer
  ON public.financial_audit_runs (user_id, employer_id)
  WHERE status = 'RUNNING';
CREATE INDEX idx_financial_audit_runs_owner_started
  ON public.financial_audit_runs (user_id, employer_id, started_at DESC);
CREATE INDEX idx_financial_audit_runs_owner_completed
  ON public.financial_audit_runs (user_id, employer_id, completed_at DESC)
  WHERE status = 'COMPLETED';

CREATE TABLE public.financial_audit_check_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  employer_id UUID NOT NULL REFERENCES public.employer_profiles(id) ON DELETE RESTRICT,
  check_id TEXT NOT NULL CHECK (char_length(check_id) BETWEEN 1 AND 100),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  result TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL', 'NOT_APPLICABLE')),
  explanation TEXT NOT NULL CHECK (char_length(explanation) BETWEEN 1 AND 2000),
  entity_type TEXT,
  entity_id UUID,
  findings JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(findings) = 'array'),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_audit_check_results_run_owner_fk
    FOREIGN KEY (run_id, user_id, employer_id)
    REFERENCES public.financial_audit_runs(id, user_id, employer_id)
    ON DELETE CASCADE,
  CONSTRAINT financial_audit_check_results_entity_type_check
    CHECK (entity_type IS NULL OR char_length(entity_type) BETWEEN 1 AND 80),
  CONSTRAINT financial_audit_check_results_entity_pair_check
    CHECK ((entity_type IS NULL) = (entity_id IS NULL)),
  CONSTRAINT financial_audit_check_results_unique_check_per_entity
    UNIQUE (run_id, check_id, entity_type, entity_id)
);

CREATE INDEX idx_financial_audit_check_results_run
  ON public.financial_audit_check_results (user_id, employer_id, run_id, checked_at, check_id);

ALTER TABLE public.financial_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_audit_check_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_audit_runs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.financial_audit_check_results FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.financial_audit_runs TO authenticated, service_role;
GRANT SELECT ON public.financial_audit_check_results TO authenticated, service_role;

CREATE POLICY "Employers can view their financial audit runs"
  ON public.financial_audit_runs FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_audit_runs.employer_id
        AND ep.user_id = auth.uid()
    )
  );
CREATE POLICY "Employers can view their financial audit check results"
  ON public.financial_audit_check_results FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.employer_profiles ep
      WHERE ep.id = financial_audit_check_results.employer_id
        AND ep.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.start_financial_audit_run(
  p_user_id UUID,
  p_employer_id UUID,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_run public.financial_audit_runs%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'FINANCIAL_AUDIT_AUTHORIZATION_FAILED'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.employer_profiles ep ON ep.user_id = u.id
    WHERE u.id = p_user_id AND u.role::TEXT = 'EMPLOYER' AND ep.id = p_employer_id
  ) THEN
    RAISE EXCEPTION 'FINANCIAL_EMPLOYER_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'FINANCIAL_AUDIT_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run
  FROM public.financial_audit_runs
  WHERE employer_id = p_employer_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_run.user_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'FINANCIAL_AUDIT_IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('run', to_jsonb(v_run), 'created', FALSE);
  END IF;

  BEGIN
    INSERT INTO public.financial_audit_runs (user_id, employer_id, idempotency_key, status)
    VALUES (p_user_id, p_employer_id, p_idempotency_key, 'RUNNING')
    RETURNING * INTO v_run;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_run
    FROM public.financial_audit_runs
    WHERE employer_id = p_employer_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_run.user_id IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'FINANCIAL_AUDIT_IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'P0001';
      END IF;
      RETURN jsonb_build_object('run', to_jsonb(v_run), 'created', FALSE);
    END IF;
    RAISE;
  END;
  RETURN jsonb_build_object('run', to_jsonb(v_run), 'created', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.start_financial_audit_run(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_financial_audit_run(UUID, UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.save_financial_audit_check_results(
  p_run_id UUID,
  p_user_id UUID,
  p_employer_id UUID,
  p_results JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_run public.financial_audit_runs%ROWTYPE;
  v_saved INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'FINANCIAL_AUDIT_AUTHORIZATION_FAILED' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_results) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'FINANCIAL_AUDIT_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.employer_profiles ep ON ep.user_id = u.id
    WHERE u.id = p_user_id AND u.role::TEXT = 'EMPLOYER' AND ep.id = p_employer_id
  ) THEN
    RAISE EXCEPTION 'FINANCIAL_EMPLOYER_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_run
  FROM public.financial_audit_runs
  WHERE id = p_run_id AND user_id = p_user_id AND employer_id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINANCIAL_AUDIT_RUN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'FINANCIAL_AUDIT_RUN_ALREADY_FINISHED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.financial_audit_check_results (
    run_id, user_id, employer_id, check_id, title, result, explanation,
    entity_type, entity_id, findings, checked_at
  )
  SELECT
    p_run_id, p_user_id, p_employer_id, result_row.check_id, result_row.title,
    result_row.result, result_row.explanation, result_row.entity_type,
    result_row.entity_id, COALESCE(result_row.findings, '[]'::JSONB),
    COALESCE(result_row.checked_at, NOW())
  FROM jsonb_to_recordset(p_results) AS result_row(
    check_id TEXT,
    title TEXT,
    result TEXT,
    explanation TEXT,
    entity_type TEXT,
    entity_id UUID,
    findings JSONB,
    checked_at TIMESTAMPTZ
  )
  ON CONFLICT (run_id, check_id, entity_type, entity_id) DO NOTHING;
  GET DIAGNOSTICS v_saved = ROW_COUNT;
  RETURN v_saved;
END;
$$;

REVOKE ALL ON FUNCTION public.save_financial_audit_check_results(UUID, UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_financial_audit_check_results(UUID, UUID, UUID, JSONB)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finish_financial_audit_run(
  p_run_id UUID,
  p_user_id UUID,
  p_employer_id UUID,
  p_status TEXT,
  p_results JSONB,
  p_error_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_run public.financial_audit_runs%ROWTYPE;
  v_passed INTEGER;
  v_failed INTEGER;
  v_not_applicable INTEGER;
  v_total INTEGER;
  v_pass_rate NUMERIC(5, 2);
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'FINANCIAL_AUDIT_AUTHORIZATION_FAILED'
      USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('COMPLETED', 'FAILED')
     OR jsonb_typeof(p_results) IS DISTINCT FROM 'array'
     OR char_length(COALESCE(p_error_message, '')) > 1000 THEN
    RAISE EXCEPTION 'FINANCIAL_AUDIT_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.employer_profiles ep ON ep.user_id = u.id
    WHERE u.id = p_user_id AND u.role::TEXT = 'EMPLOYER' AND ep.id = p_employer_id
  ) THEN
    RAISE EXCEPTION 'FINANCIAL_EMPLOYER_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_run
  FROM public.financial_audit_runs
  WHERE id = p_run_id AND user_id = p_user_id AND employer_id = p_employer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINANCIAL_AUDIT_RUN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'FINANCIAL_AUDIT_RUN_ALREADY_FINISHED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.financial_audit_check_results (
    run_id, user_id, employer_id, check_id, title, result, explanation,
    entity_type, entity_id, findings, checked_at
  )
  SELECT
    p_run_id, p_user_id, p_employer_id, result_row.check_id, result_row.title,
    result_row.result, result_row.explanation, result_row.entity_type,
    result_row.entity_id, COALESCE(result_row.findings, '[]'::JSONB),
    COALESCE(result_row.checked_at, NOW())
  FROM jsonb_to_recordset(p_results) AS result_row(
    check_id TEXT,
    title TEXT,
    result TEXT,
    explanation TEXT,
    entity_type TEXT,
    entity_id UUID,
    findings JSONB,
    checked_at TIMESTAMPTZ
  );

  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE result = 'PASS')::INTEGER,
    COUNT(*) FILTER (WHERE result = 'FAIL')::INTEGER,
    COUNT(*) FILTER (WHERE result = 'NOT_APPLICABLE')::INTEGER
  INTO v_total, v_passed, v_failed, v_not_applicable
  FROM public.financial_audit_check_results
  WHERE run_id = p_run_id AND user_id = p_user_id AND employer_id = p_employer_id;

  v_pass_rate := CASE
    WHEN p_status = 'COMPLETED' AND v_passed + v_failed > 0
      THEN ROUND(v_passed::NUMERIC * 100 / (v_passed + v_failed), 2)
    ELSE NULL
  END;
  UPDATE public.financial_audit_runs
  SET status = p_status,
      completed_at = NOW(),
      total_checks = v_total,
      passed_checks = v_passed,
      failed_checks = v_failed,
      not_applicable_checks = v_not_applicable,
      pass_rate = v_pass_rate,
      summary = jsonb_build_object(
        'passed', v_passed,
        'failed', v_failed,
        'not_applicable', v_not_applicable,
        'total', v_total
      ),
      error_message = NULLIF(p_error_message, '')
  WHERE id = p_run_id AND user_id = p_user_id AND employer_id = p_employer_id
  RETURNING * INTO v_run;
  RETURN to_jsonb(v_run);
END;
$$;

REVOKE ALL ON FUNCTION public.finish_financial_audit_run(UUID, UUID, UUID, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_financial_audit_run(UUID, UUID, UUID, TEXT, JSONB, TEXT)
  TO service_role;

COMMIT;
