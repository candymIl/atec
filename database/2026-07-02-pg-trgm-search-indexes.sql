-- ATEC pg_trgm search indexes
-- Purpose:
--   Speed up broad searches that use ILIKE '%text%' on asset, customer,
--   site, section and certificate search fields.
--
-- Safe to run more than once.
-- Run against the fbcranes database as a user allowed to create extensions.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_tblasset_serialno_trgm
  ON atec.tblasset USING gin (lower(serialno) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tblasset_assettagno_trgm
  ON atec.tblasset USING gin (lower(assettagno) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tblasset_hoistserialno_trgm
  ON atec.tblasset USING gin (lower(hoistserialno) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tblasset_auxhoistserialno_trgm
  ON atec.tblasset USING gin (lower(auxhoistserialno) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tblasset_qrcode_trgm
  ON atec.tblasset USING gin (lower(qrcode) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tblasset_description_trgm
  ON atec.tblasset USING gin (lower(description) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tblclients_clientname_trgm
  ON atec.tblclients USING gin (lower(clientname) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tblsites_sitename_trgm
  ON atec.tblsites USING gin (lower(sitename) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tblsection_sectionname_trgm
  ON atec.tblsection USING gin (lower(sectionname) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tblequiptype_description_trgm
  ON atec.tblequiptype USING gin (lower(description) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tblinspection_tagnumber_trgm
  ON atec.tblinspection USING gin (lower(tagnumber) gin_trgm_ops);

COMMIT;
