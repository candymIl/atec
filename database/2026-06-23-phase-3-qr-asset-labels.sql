BEGIN;

ALTER TABLE atec.tblasset
  ADD COLUMN IF NOT EXISTS qrcode text;

UPDATE atec.tblasset
SET qrcode = 'ATEC-ASSET-' || assetid
WHERE qrcode IS NULL
   OR btrim(qrcode) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tblasset_qrcode_unique
  ON atec.tblasset (qrcode)
  WHERE qrcode IS NOT NULL
    AND btrim(qrcode) <> '';

COMMIT;
