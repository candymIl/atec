-- Task 12A refinement: allow Crane Wizard inspections to save without an inspection tag number.
-- This is intentionally narrow: it does not change supplied tag values or existing uniqueness rules.
-- Blank values submitted by the app are saved as NULL by the existing inspection save route.
--
-- Read-only audit:
-- SELECT
--   table_schema,
--   table_name,
--   column_name,
--   is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'atec'
--   AND table_name = 'tblinspection'
--   AND column_name = 'tagnumber';
--
-- Rollback guidance:
-- Only reapply NOT NULL if all existing rows have a tag number:
-- SELECT COUNT(*) FROM atec.tblinspection WHERE tagnumber IS NULL;
-- ALTER TABLE atec.tblinspection ALTER COLUMN tagnumber SET NOT NULL;

BEGIN;

ALTER TABLE atec.tblinspection
  ALTER COLUMN tagnumber DROP NOT NULL;

COMMIT;
