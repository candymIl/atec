BEGIN;

-- Legacy asset master-data columns were created with short varchar limits.
-- Modern asset descriptions and identification values must not fail when a
-- clear, useful description is longer than those original limits.
ALTER TABLE atec.tblasset
  ALTER COLUMN serialno TYPE text,
  ALTER COLUMN assettagno TYPE text,
  ALTER COLUMN manufacturer TYPE text,
  ALTER COLUMN description TYPE text,
  ALTER COLUMN wll TYPE text;

COMMIT;
