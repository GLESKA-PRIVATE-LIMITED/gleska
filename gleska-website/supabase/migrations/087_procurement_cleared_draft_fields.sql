BEGIN;

ALTER TABLE public.procurement_conversations
  ADD COLUMN IF NOT EXISTS cleared_fields TEXT[] NOT NULL DEFAULT '{}'::text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'procurement_conversations_cleared_fields_check'
      AND conrelid = 'public.procurement_conversations'::regclass
  ) THEN
    ALTER TABLE public.procurement_conversations
      ADD CONSTRAINT procurement_conversations_cleared_fields_check
      CHECK (
        cleared_fields <@ ARRAY[
          'title', 'item_name', 'specification', 'quantity', 'unit',
          'required_by', 'delivery_location', 'additional_requirements', 'notes'
        ]::text[]
      );
  END IF;
END;
$$;

COMMIT;
