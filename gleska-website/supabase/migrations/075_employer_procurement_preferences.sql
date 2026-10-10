BEGIN;

ALTER TABLE public.employer_preferences
  ADD COLUMN IF NOT EXISTS procurement_default_delivery_location TEXT
    CHECK (
      procurement_default_delivery_location IS NULL
      OR length(trim(procurement_default_delivery_location)) BETWEEN 1 AND 500
    ),
  ADD COLUMN IF NOT EXISTS procurement_preferred_units TEXT[] NOT NULL
    DEFAULT ARRAY[]::TEXT[]
    CHECK (
      cardinality(procurement_preferred_units) <= 9
      AND procurement_preferred_units <@ ARRAY[
        'MT', 'Bags', 'Pieces', 'Kg', 'Tons', 'Meters', 'Sq. ft', 'Boxes', 'Liters'
      ]::TEXT[]
    ),
  ADD COLUMN IF NOT EXISTS procurement_specification_match_policy TEXT NOT NULL
    DEFAULT 'REVIEW_DIFFERENCES'
    CHECK (
      procurement_specification_match_policy IN (
        'REVIEW_DIFFERENCES', 'REQUIRE_OVERLAP'
      )
    ),
  ADD COLUMN IF NOT EXISTS procurement_delivery_coverage_policy TEXT NOT NULL
    DEFAULT 'ALLOW_UNSPECIFIED'
    CHECK (
      procurement_delivery_coverage_policy IN (
        'ALLOW_UNSPECIFIED', 'REQUIRE_MATCH'
      )
    );

COMMIT;
