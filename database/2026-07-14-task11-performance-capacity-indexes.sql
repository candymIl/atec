-- ATEC Task 11 performance and capacity indexes
--
-- Purpose:
--   Support confirmed query patterns in backend/server.js without changing
--   business behaviour. This file is safe to rerun.
--
-- Production guidance:
--   Run only after a verified backup. Use EXPLAIN (ANALYZE, BUFFERS) on a
--   staging or maintenance window before and after applying indexes.
--   CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so this
--   file intentionally does not use BEGIN/COMMIT.

-- Supports latest visual/load inspection lookups in customer detailed reports
-- and dashboard summaries where queries filter by assetid + inspectiontype and
-- order by testdate/testid descending.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblinspection_asset_type_testdate_testid
  ON atec.tblinspection (assetid, inspectiontype, testdate DESC, testid DESC);

-- Supports certificate search, dashboard counts and report filters that combine
-- status/date/type predicates with date ordering.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblinspection_status_testdate_type
  ON atec.tblinspection (status, testdate DESC, inspectiontype);

-- Supports upcoming expiry dashboard and customer report overdue filters.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblinspection_validdate_asset_type
  ON atec.tblinspection (validdate, assetid, inspectiontype);

-- Supports active asset lists and customer-scoped dashboard/report queries.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_active_client_asset
  ON atec.tblasset (clientid, assetid)
  WHERE COALESCE(archived, false) = false;

-- Supports asset/report filtering by site and section within a customer.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_client_site_section_asset
  ON atec.tblasset (clientid, siteid, sectionid, assetid);

-- Supports joins from assets to responsible person and customer detailed report
-- responsible-person filters.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblasset_responsibleid
  ON atec.tblasset (responsibleid);

-- Supports sites lists, dependent site dropdowns and site joins.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblsites_clientid_siteid
  ON atec.tblsites (clientid, siteid);

-- Supports section lists, dependent section dropdowns and section joins.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblsection_siteid_sectionid
  ON atec.tblsection (siteid, sectionid);

-- Supports SHE risk assessment listing and export filters by status/date/asset.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tblriskassessment_status_date_asset
  ON atec.tblriskassessment (status, assessment_date DESC, assetid);

-- Read-only EXPLAIN examples, not executed automatically:
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT DISTINCT ON (i.assetid, i.inspectiontype) i.assetid, i.inspectiontype, i.testdate
-- FROM atec.tblinspection i
-- ORDER BY i.assetid, i.inspectiontype, i.testdate DESC, i.testid DESC;
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT count(*)
-- FROM atec.tblasset a
-- JOIN atec.tblinspection i ON i.assetid = a.assetid
-- WHERE a.clientid = 1 AND i.testdate >= current_date - interval '1 year';
