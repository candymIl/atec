-- Milestone 1D: repair deterministic asset hierarchy inconsistencies.
--
-- Approved non-production target:
--   database: fbcranes
--   schema:   atec
--
-- Valid hierarchy:
--   customer -> site -> section -> asset
--
-- This migration updates only Category C assets:
--   - the asset references an existing active section
--   - the section references an existing active site and customer
--   - the section/site/customer hierarchy is internally consistent
--   - the only defect is a duplicated tblasset.siteid value that disagrees
--     with the authoritative section hierarchy
--
-- It intentionally does not update responsible-person, inspection, criteria,
-- tag, people, customer, site, section, archive, or migration-ledger records.

BEGIN;

DO $$
BEGIN
  IF current_database() <> 'fbcranes' THEN
    RAISE EXCEPTION 'Refusing to run outside approved database fbcranes; current database is %', current_database();
  END IF;

  IF to_regnamespace('atec') IS NULL THEN
    RAISE EXCEPTION 'Refusing to run because schema atec is not available';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS atec.asset_hierarchy_repair_audit (
  migration_name text NOT NULL,
  assetid bigint NOT NULL,
  previous_clientid bigint,
  previous_siteid bigint,
  previous_sectionid bigint,
  previous_responsibleid bigint,
  previous_assettagno text,
  proposed_clientid bigint,
  proposed_siteid bigint,
  proposed_sectionid bigint,
  repair_category text NOT NULL,
  deterministic_evidence text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text NOT NULL DEFAULT current_user,
  PRIMARY KEY (migration_name, assetid)
);

CREATE TEMP TABLE _m1d_expected_candidates (
  assetid bigint PRIMARY KEY,
  expected_clientid bigint NOT NULL,
  expected_siteid bigint NOT NULL,
  expected_sectionid bigint NOT NULL,
  proposed_clientid bigint NOT NULL,
  proposed_siteid bigint NOT NULL,
  proposed_sectionid bigint NOT NULL,
  repair_category text NOT NULL,
  deterministic_evidence text NOT NULL
) ON COMMIT DROP;

INSERT INTO _m1d_expected_candidates (
  assetid,
  expected_clientid,
  expected_siteid,
  expected_sectionid,
  proposed_clientid,
  proposed_siteid,
  proposed_sectionid,
  repair_category,
  deterministic_evidence
)
VALUES
  (2997, 1, 11, 5, 1, 10, 5, 'C', 'valid current section is authoritative for site and customer'),
  (6873, 1, 11, 22, 1, 10, 22, 'C', 'valid current section is authoritative for site and customer'),
  (8720, 1, 13, 147, 1, 10, 147, 'C', 'valid current section is authoritative for site and customer'),
  (16464, 1, 11, 22, 1, 10, 22, 'C', 'valid current section is authoritative for site and customer'),
  (21670, 1, 10, 43, 1, 11, 43, 'C', 'valid current section is authoritative for site and customer'),
  (35921, 1, 10, 10, 1, 11, 10, 'C', 'valid current section is authoritative for site and customer');

CREATE TEMP TABLE _m1d_recalculated_candidates ON COMMIT DROP AS
SELECT
  a.assetid,
  a.clientid AS previous_clientid,
  a.siteid AS previous_siteid,
  a.sectionid AS previous_sectionid,
  a.responsibleid AS previous_responsibleid,
  NULLIF(TRIM(a.assettagno), '') AS previous_assettagno,
  sec.clientid AS proposed_clientid,
  sec.siteid AS proposed_siteid,
  sec.sectionid AS proposed_sectionid,
  'C'::text AS repair_category,
  'valid current section is authoritative for site and customer'::text AS deterministic_evidence
FROM atec.tblasset a
JOIN atec.tblsection sec
  ON sec.sectionid = a.sectionid
JOIN atec.tblsites section_site
  ON section_site.siteid = sec.siteid
JOIN atec.tblclients section_client
  ON section_client.clientid = sec.clientid
JOIN atec.tblsites asset_site
  ON asset_site.siteid = a.siteid
JOIN atec.tblclients asset_client
  ON asset_client.clientid = a.clientid
WHERE COALESCE(a.archived, false) = false
  AND COALESCE(sec.archived, false) = false
  AND COALESCE(section_site.archived, false) = false
  AND COALESCE(section_client.archived, false) = false
  AND COALESCE(asset_site.archived, false) = false
  AND COALESCE(asset_client.archived, false) = false
  AND sec.clientid IS NOT DISTINCT FROM section_site.clientid
  AND a.clientid IS NOT DISTINCT FROM sec.clientid
  AND a.siteid IS DISTINCT FROM sec.siteid
  AND a.sectionid IS NOT NULL;

CREATE TEMP TABLE _m1d_candidates ON COMMIT DROP AS
SELECT
  rc.*
FROM _m1d_recalculated_candidates rc
JOIN _m1d_expected_candidates ec
  ON ec.assetid = rc.assetid
 AND ec.expected_clientid IS NOT DISTINCT FROM rc.previous_clientid
 AND ec.expected_siteid IS NOT DISTINCT FROM rc.previous_siteid
 AND ec.expected_sectionid IS NOT DISTINCT FROM rc.previous_sectionid
 AND ec.proposed_clientid IS NOT DISTINCT FROM rc.proposed_clientid
 AND ec.proposed_siteid IS NOT DISTINCT FROM rc.proposed_siteid
 AND ec.proposed_sectionid IS NOT DISTINCT FROM rc.proposed_sectionid
 AND ec.repair_category = rc.repair_category
 AND ec.deterministic_evidence = rc.deterministic_evidence;

DO $$
DECLARE
  expected_count constant integer := 6;
  expected_rows integer;
  recalculated_rows integer;
  candidate_rows integer;
  missing_expected_rows integer;
  unexpected_rows integer;
  duplicate_rows integer;
  invalid_parent_rows integer;
  unresolved_final_rows integer;
BEGIN
  SELECT COUNT(*) INTO expected_rows FROM _m1d_expected_candidates;
  SELECT COUNT(*) INTO recalculated_rows FROM _m1d_recalculated_candidates;
  SELECT COUNT(*) INTO candidate_rows FROM _m1d_candidates;

  IF expected_rows <> expected_count THEN
    RAISE EXCEPTION 'Embedded candidate count changed: expected %, got %', expected_count, expected_rows;
  END IF;

  IF candidate_rows <> expected_count THEN
    RAISE EXCEPTION 'Candidate set drifted: expected %, got %', expected_count, candidate_rows;
  END IF;

  SELECT COUNT(*) INTO missing_expected_rows
  FROM _m1d_expected_candidates ec
  LEFT JOIN _m1d_candidates c
    ON c.assetid = ec.assetid
  WHERE c.assetid IS NULL;
  IF missing_expected_rows <> 0 THEN
    RAISE EXCEPTION 'Refusing migration: % expected candidates are no longer valid', missing_expected_rows;
  END IF;

  SELECT COUNT(*) INTO unexpected_rows
  FROM _m1d_recalculated_candidates rc
  LEFT JOIN _m1d_expected_candidates ec
    ON ec.assetid = rc.assetid
  WHERE ec.assetid IS NULL;
  IF unexpected_rows <> 0 THEN
    RAISE EXCEPTION 'Refusing migration: % newly deterministic candidates are not embedded for review', unexpected_rows;
  END IF;

  SELECT COUNT(*) INTO duplicate_rows
  FROM (
    SELECT assetid
    FROM _m1d_candidates
    GROUP BY assetid
    HAVING COUNT(*) > 1
  ) dup;
  IF duplicate_rows <> 0 THEN
    RAISE EXCEPTION 'Refusing migration: % duplicate candidate assets', duplicate_rows;
  END IF;

  SELECT COUNT(*) INTO invalid_parent_rows
  FROM _m1d_candidates c
  LEFT JOIN atec.tblclients proposed_client
    ON proposed_client.clientid = c.proposed_clientid
  LEFT JOIN atec.tblsites proposed_site
    ON proposed_site.siteid = c.proposed_siteid
  LEFT JOIN atec.tblsection proposed_section
    ON proposed_section.sectionid = c.proposed_sectionid
  WHERE proposed_client.clientid IS NULL
    OR proposed_site.siteid IS NULL
    OR proposed_section.sectionid IS NULL
    OR COALESCE(proposed_client.archived, false) = true
    OR COALESCE(proposed_site.archived, false) = true
    OR COALESCE(proposed_section.archived, false) = true
    OR proposed_site.clientid IS DISTINCT FROM proposed_client.clientid
    OR proposed_section.clientid IS DISTINCT FROM proposed_client.clientid
    OR proposed_section.siteid IS DISTINCT FROM proposed_site.siteid;
  IF invalid_parent_rows <> 0 THEN
    RAISE EXCEPTION 'Refusing migration: % proposed parent hierarchies are invalid or archived', invalid_parent_rows;
  END IF;

  SELECT COUNT(*) INTO unresolved_final_rows
  FROM _m1d_candidates c
  WHERE c.previous_clientid IS DISTINCT FROM c.proposed_clientid
    OR c.previous_sectionid IS DISTINCT FROM c.proposed_sectionid;
  IF unresolved_final_rows <> 0 THEN
    RAISE EXCEPTION 'Refusing migration: Category C candidates may only correct duplicated siteid, found % other field changes', unresolved_final_rows;
  END IF;
END $$;

INSERT INTO atec.asset_hierarchy_repair_audit (
  migration_name,
  assetid,
  previous_clientid,
  previous_siteid,
  previous_sectionid,
  previous_responsibleid,
  previous_assettagno,
  proposed_clientid,
  proposed_siteid,
  proposed_sectionid,
  repair_category,
  deterministic_evidence
)
SELECT
  '2026-07-16-repair-deterministic-asset-hierarchy-inconsistencies.sql',
  assetid,
  previous_clientid,
  previous_siteid,
  previous_sectionid,
  previous_responsibleid,
  previous_assettagno,
  proposed_clientid,
  proposed_siteid,
  proposed_sectionid,
  repair_category,
  deterministic_evidence
FROM _m1d_candidates;

WITH updated AS (
  UPDATE atec.tblasset a
  SET
    clientid = c.proposed_clientid,
    siteid = c.proposed_siteid,
    sectionid = c.proposed_sectionid
  FROM _m1d_candidates c
  WHERE a.assetid = c.assetid
    AND a.clientid IS NOT DISTINCT FROM c.previous_clientid
    AND a.siteid IS NOT DISTINCT FROM c.previous_siteid
    AND a.sectionid IS NOT DISTINCT FROM c.previous_sectionid
    AND a.responsibleid IS NOT DISTINCT FROM c.previous_responsibleid
  RETURNING a.assetid
)
SELECT COUNT(*) AS updated_asset_count
FROM updated;

DO $$
DECLARE
  expected_count constant integer := 6;
  audit_rows integer;
  hierarchy_failures integer;
  responsible_changes integer;
  tag_changes integer;
BEGIN
  SELECT COUNT(*) INTO audit_rows
  FROM atec.asset_hierarchy_repair_audit
  WHERE migration_name = '2026-07-16-repair-deterministic-asset-hierarchy-inconsistencies.sql';

  IF audit_rows <> expected_count THEN
    RAISE EXCEPTION 'Audit row count mismatch: expected %, got %', expected_count, audit_rows;
  END IF;

  SELECT COUNT(*) INTO hierarchy_failures
  FROM atec.asset_hierarchy_repair_audit audit
  JOIN atec.tblasset a
    ON a.assetid = audit.assetid
  JOIN atec.tblsection sec
    ON sec.sectionid = a.sectionid
  JOIN atec.tblsites s
    ON s.siteid = a.siteid
  WHERE audit.migration_name = '2026-07-16-repair-deterministic-asset-hierarchy-inconsistencies.sql'
    AND (
      a.clientid IS DISTINCT FROM s.clientid
      OR a.siteid IS DISTINCT FROM sec.siteid
      OR a.clientid IS DISTINCT FROM sec.clientid
      OR COALESCE(sec.archived, false) = true
      OR COALESCE(s.archived, false) = true
    );
  IF hierarchy_failures <> 0 THEN
    RAISE EXCEPTION 'Postcondition failed: % repaired assets still have invalid hierarchy', hierarchy_failures;
  END IF;

  SELECT COUNT(*) INTO responsible_changes
  FROM atec.asset_hierarchy_repair_audit audit
  JOIN atec.tblasset a
    ON a.assetid = audit.assetid
  WHERE audit.migration_name = '2026-07-16-repair-deterministic-asset-hierarchy-inconsistencies.sql'
    AND a.responsibleid IS DISTINCT FROM audit.previous_responsibleid;
  IF responsible_changes <> 0 THEN
    RAISE EXCEPTION 'Postcondition failed: % responsible-person fields changed', responsible_changes;
  END IF;

  SELECT COUNT(*) INTO tag_changes
  FROM atec.asset_hierarchy_repair_audit audit
  JOIN atec.tblasset a
    ON a.assetid = audit.assetid
  WHERE audit.migration_name = '2026-07-16-repair-deterministic-asset-hierarchy-inconsistencies.sql'
    AND NULLIF(TRIM(a.assettagno), '') IS DISTINCT FROM audit.previous_assettagno;
  IF tag_changes <> 0 THEN
    RAISE EXCEPTION 'Postcondition failed: % asset tag values changed', tag_changes;
  END IF;
END $$;

COMMIT;
