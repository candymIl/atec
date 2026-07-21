-- Prevent duplicate active asset serial numbers within the same customer.
--
-- Rules:
-- - Serial numbers are compared case-insensitively after trimming spaces.
-- - Empty serial numbers are allowed because some assets may not have a known serial yet.
-- - Archived assets are excluded so historical duplicates can stay archived safely.
-- - The script stops before adding the index if active duplicates still exist.

BEGIN;

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT COUNT(*)
  INTO duplicate_count
  FROM (
    SELECT clientid, LOWER(TRIM(serialno)) AS normalized_serial
    FROM atec.tblasset
    WHERE clientid IS NOT NULL
      AND serialno IS NOT NULL
      AND TRIM(serialno) <> ''
      AND COALESCE(archived, false) = false
    GROUP BY clientid, LOWER(TRIM(serialno))
    HAVING COUNT(*) > 1
  ) duplicate_groups;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add duplicate serial protection. % duplicate active customer/serial groups still exist.',
      duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tblasset_active_client_serial
  ON atec.tblasset (clientid, LOWER(TRIM(serialno)))
  WHERE clientid IS NOT NULL
    AND serialno IS NOT NULL
    AND TRIM(serialno) <> ''
    AND COALESCE(archived, false) = false;

COMMIT;
