-- Work Package 1: prevent duplicate active nonblank asset tags per customer.
--
-- Blank asset tags are intentionally allowed. This safeguard only prevents two
-- active assets for the same customer from sharing the same normalized nonblank
-- asset tag.

BEGIN;

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  IF current_database() <> 'fbcranes' THEN
    RAISE EXCEPTION 'Refusing to run outside approved database fbcranes; current database is %', current_database();
  END IF;

  IF to_regnamespace('atec') IS NULL THEN
    RAISE EXCEPTION 'Refusing to run because schema atec is not available';
  END IF;

  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT clientid, lower(trim(assettagno)) AS normalized_tag
    FROM atec.tblasset
    WHERE COALESCE(archived, false) = false
      AND clientid IS NOT NULL
      AND NULLIF(TRIM(COALESCE(assettagno, '')), '') IS NOT NULL
    GROUP BY clientid, lower(trim(assettagno))
    HAVING COUNT(*) > 1
  ) dup;

  IF duplicate_count <> 0 THEN
    RAISE EXCEPTION 'Cannot add active nonblank asset-tag uniqueness: % duplicate customer/tag groups remain', duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tblasset_active_client_assettagno_normalized
  ON atec.tblasset (clientid, lower(trim(assettagno)))
  WHERE COALESCE(archived, false) = false
    AND clientid IS NOT NULL
    AND NULLIF(TRIM(COALESCE(assettagno, '')), '') IS NOT NULL;

COMMIT;
