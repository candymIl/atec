BEGIN;

ALTER TABLE atec.tblasset
  ADD COLUMN IF NOT EXISTS nfc_token text,
  ADD COLUMN IF NOT EXISTS nfc_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nfc_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS nfc_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS nfc_last_scanned_at timestamptz,
  ADD COLUMN IF NOT EXISTS nfc_scan_count integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tblasset_active_nfc_token
  ON atec.tblasset (nfc_token)
  WHERE nfc_token IS NOT NULL
    AND btrim(nfc_token) <> ''
    AND nfc_revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tblasset_nfc_enabled
  ON atec.tblasset (nfc_enabled, nfc_revoked_at)
  WHERE nfc_token IS NOT NULL;

-- Read-only audit:
-- SELECT COUNT(*) AS assets_with_nfc_token FROM atec.tblasset WHERE nfc_token IS NOT NULL;
-- SELECT nfc_token, COUNT(*) FROM atec.tblasset WHERE nfc_token IS NOT NULL GROUP BY nfc_token HAVING COUNT(*) > 1;
-- SELECT assetid, nfc_enabled, nfc_issued_at, nfc_revoked_at, nfc_last_scanned_at, nfc_scan_count
-- FROM atec.tblasset
-- WHERE nfc_token IS NOT NULL
-- ORDER BY nfc_issued_at DESC NULLS LAST, assetid DESC
-- LIMIT 50;

-- Rollback guidance:
-- DROP INDEX IF EXISTS atec.idx_tblasset_nfc_enabled;
-- DROP INDEX IF EXISTS atec.uq_tblasset_active_nfc_token;
-- ALTER TABLE atec.tblasset
--   DROP COLUMN IF EXISTS nfc_scan_count,
--   DROP COLUMN IF EXISTS nfc_last_scanned_at,
--   DROP COLUMN IF EXISTS nfc_revoked_at,
--   DROP COLUMN IF EXISTS nfc_issued_at,
--   DROP COLUMN IF EXISTS nfc_enabled,
--   DROP COLUMN IF EXISTS nfc_token;

COMMIT;
