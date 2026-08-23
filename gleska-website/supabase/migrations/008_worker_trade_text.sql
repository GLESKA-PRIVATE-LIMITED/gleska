-- The worker UI collects a free-text trade/skill; no profession table or UUID
-- lookup exists in the current product model.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'worker_profiles'
      AND column_name = 'trade_id'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE public.worker_profiles
      ALTER COLUMN trade_id TYPE TEXT
      USING trade_id::text;
  END IF;
END $$;