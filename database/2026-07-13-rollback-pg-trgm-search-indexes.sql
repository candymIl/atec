-- Rollback for database/2026-07-02-pg-trgm-search-indexes.sql
-- Drops only the trigram indexes introduced by that migration.
-- Do not wrap this file in BEGIN/COMMIT: DROP INDEX CONCURRENTLY is not allowed
-- inside a transaction block.
-- The pg_trgm extension is intentionally left installed because other objects
-- may depend on it after production use.

DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblasset_serialno_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblasset_assettagno_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblasset_hoistserialno_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblasset_auxhoistserialno_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblasset_qrcode_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblasset_description_trgm;

DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblasset_serialno_lower_coalesce_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblasset_assettagno_lower_coalesce_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblasset_hoistserialno_lower_coalesce_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblasset_auxhoistserialno_lower_coalesce_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblasset_qrcode_lower_coalesce_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblasset_description_lower_coalesce_trgm;

DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblclients_clientname_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblclients_clientname_lower_coalesce_trgm;

DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblsites_sitename_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblsites_sitename_lower_coalesce_trgm;

DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblsection_sectionname_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblsection_sectionname_lower_coalesce_trgm;

DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblpeople_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblpeople_name_lower_coalesce_trgm;

DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblequiptype_description_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblequiptype_description_lower_coalesce_trgm;

DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblinspection_tagnumber_trgm;
DROP INDEX CONCURRENTLY IF EXISTS atec.idx_tblinspection_tagnumber_lower_coalesce_trgm;
