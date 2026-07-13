-- ATEC pg_trgm search indexes
-- Purpose:
--   Speed up broad searches that use ILIKE '%text%' on asset, customer,
--   site, section and certificate search fields.
--
-- Safe to run more than once.
-- Run against the fbcranes database as a user allowed to create extensions.
--
-- Production note:
--   CREATE INDEX CONCURRENTLY is used so live reads/writes can continue while
--   indexes are built. Because PostgreSQL does not allow concurrent index
--   builds inside an explicit transaction block, this file intentionally does
--   not use BEGIN/COMMIT.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Supports /inspections/assets/search and /certificates/search raw ILIKE
-- predicates on asset fields.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_serialno_trgm
  ON atec.tblasset USING gin (serialno gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_assettagno_trgm
  ON atec.tblasset USING gin (assettagno gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_hoistserialno_trgm
  ON atec.tblasset USING gin (hoistserialno gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_auxhoistserialno_trgm
  ON atec.tblasset USING gin (auxhoistserialno gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_qrcode_trgm
  ON atec.tblasset USING gin (qrcode gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_description_trgm
  ON atec.tblasset USING gin (description gin_trgm_ops);

-- Supports /assets list search, which currently uses
-- LOWER(COALESCE(column, '')) LIKE '%term%'.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_serialno_lower_coalesce_trgm
  ON atec.tblasset USING gin (lower(coalesce(serialno, '')) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_assettagno_lower_coalesce_trgm
  ON atec.tblasset USING gin (lower(coalesce(assettagno, '')) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_hoistserialno_lower_coalesce_trgm
  ON atec.tblasset USING gin (lower(coalesce(hoistserialno, '')) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_auxhoistserialno_lower_coalesce_trgm
  ON atec.tblasset USING gin (lower(coalesce(auxhoistserialno, '')) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_qrcode_lower_coalesce_trgm
  ON atec.tblasset USING gin (lower(coalesce(qrcode, '')) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_description_lower_coalesce_trgm
  ON atec.tblasset USING gin (lower(coalesce(description, '')) gin_trgm_ops);

-- Supports certificate/risk/customer searches by customer, site, section,
-- responsible person and equipment type names.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblclients_clientname_trgm
  ON atec.tblclients USING gin (clientname gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblclients_clientname_lower_coalesce_trgm
  ON atec.tblclients USING gin (lower(coalesce(clientname, '')) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblsites_sitename_trgm
  ON atec.tblsites USING gin (sitename gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblsites_sitename_lower_coalesce_trgm
  ON atec.tblsites USING gin (lower(coalesce(sitename, '')) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblsection_sectionname_trgm
  ON atec.tblsection USING gin (sectionname gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblsection_sectionname_lower_coalesce_trgm
  ON atec.tblsection USING gin (lower(coalesce(sectionname, '')) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblpeople_name_trgm
  ON atec.tblpeople USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblpeople_name_lower_coalesce_trgm
  ON atec.tblpeople USING gin (lower(coalesce(name, '')) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblequiptype_description_trgm
  ON atec.tblequiptype USING gin (description gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblequiptype_description_lower_coalesce_trgm
  ON atec.tblequiptype USING gin (lower(coalesce(description, '')) gin_trgm_ops);

-- Supports certificate search by inspection tag number.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblinspection_tagnumber_trgm
  ON atec.tblinspection USING gin (tagnumber gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblinspection_tagnumber_lower_coalesce_trgm
  ON atec.tblinspection USING gin (lower(coalesce(tagnumber, '')) gin_trgm_ops);
