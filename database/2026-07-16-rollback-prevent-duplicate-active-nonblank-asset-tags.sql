-- Rollback for:
--   2026-07-16-prevent-duplicate-active-nonblank-asset-tags.sql

DROP INDEX IF EXISTS atec.uq_tblasset_active_client_assettagno_normalized;
