-- Milestone 1C: assign deterministic missing section responsible persons.
--
-- Approved non-production target:
--   database: fbcranes
--   schema:   atec
--
-- Authoritative ownership relationship:
--   customer -> site -> section -> responsible person
--
-- This migration updates only Category B sections:
--   - section responsible person is currently null
--   - section and active assets are not archived
--   - all active non-null legacy asset responsible values agree on one person
--   - candidate person exists and is not archived
--   - no section/site/client hierarchy conflict exists
--   - candidate is not already linked to another active customer
--
-- It intentionally does not update atec.tblasset.responsibleid.

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

CREATE TABLE IF NOT EXISTS atec.responsible_person_ownership_repair_audit (
  migration_name text NOT NULL,
  sectionid bigint NOT NULL,
  previous_responsibleid bigint,
  assigned_responsibleid bigint NOT NULL,
  clientid bigint NOT NULL,
  siteid bigint NOT NULL,
  supporting_asset_count integer NOT NULL,
  governed_active_asset_count integer NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text NOT NULL DEFAULT current_user,
  PRIMARY KEY (migration_name, sectionid)
);

CREATE TEMP TABLE _m1c_responsible_candidates ON COMMIT DROP AS
WITH section_facts AS (
  SELECT
    sec.sectionid,
    sec.siteid,
    sec.clientid,
    sec.responsibleid AS section_responsibleid,
    COALESCE(sec.archived, false) AS section_archived,
    COUNT(a.assetid) FILTER (WHERE COALESCE(a.archived, false) = false)::int AS active_asset_count,
    COUNT(a.assetid) FILTER (
      WHERE COALESCE(a.archived, false) = false
        AND a.responsibleid IS NOT NULL
    )::int AS active_nonnull_legacy_count,
    COUNT(DISTINCT a.responsibleid) FILTER (
      WHERE COALESCE(a.archived, false) = false
        AND a.responsibleid IS NOT NULL
    )::int AS active_distinct_legacy_count,
    MIN(a.responsibleid) FILTER (
      WHERE COALESCE(a.archived, false) = false
        AND a.responsibleid IS NOT NULL
    ) AS candidate_personid,
    COUNT(a.assetid) FILTER (
      WHERE a.assetid IS NOT NULL
        AND (
          a.clientid IS DISTINCT FROM sec.clientid
          OR a.siteid IS DISTINCT FROM sec.siteid
          OR a.sectionid IS DISTINCT FROM sec.sectionid
        )
    )::int AS hierarchy_conflict_asset_count
  FROM atec.tblsection sec
  LEFT JOIN atec.tblasset a
    ON a.sectionid = sec.sectionid
  GROUP BY
    sec.sectionid,
    sec.siteid,
    sec.clientid,
    sec.responsibleid,
    sec.archived
),
candidate_sections AS (
  SELECT
    sf.sectionid,
    sf.clientid,
    sf.siteid,
    sf.section_responsibleid AS previous_responsibleid,
    sf.candidate_personid AS assigned_responsibleid,
    sf.active_nonnull_legacy_count AS supporting_asset_count,
    sf.active_asset_count AS governed_active_asset_count
  FROM section_facts sf
  JOIN atec.tblpeople p
    ON p.personid = sf.candidate_personid
  WHERE sf.section_responsibleid IS NULL
    AND sf.section_archived = false
    AND sf.active_asset_count > 0
    AND sf.active_nonnull_legacy_count > 0
    AND sf.active_distinct_legacy_count = 1
    AND sf.hierarchy_conflict_asset_count = 0
    AND COALESCE(p.archived, false) = false
    AND NOT EXISTS (
      SELECT 1
      FROM atec.tblsection other_sec
      WHERE other_sec.responsibleid = sf.candidate_personid
        AND other_sec.clientid IS DISTINCT FROM sf.clientid
        AND COALESCE(other_sec.archived, false) = false
    )
)
SELECT *
FROM candidate_sections;

DO $$
DECLARE
  expected_section_count constant integer := 309;
  candidate_count integer;
  duplicate_count integer;
  invalid_person_count integer;
  already_owned_count integer;
  cross_customer_count integer;
  hierarchy_conflict_count integer;
BEGIN
  SELECT COUNT(*) INTO candidate_count FROM _m1c_responsible_candidates;
  IF candidate_count <> expected_section_count THEN
    RAISE EXCEPTION 'Candidate count changed: expected %, got %', expected_section_count, candidate_count;
  END IF;

  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT sectionid
    FROM _m1c_responsible_candidates
    GROUP BY sectionid
    HAVING COUNT(*) > 1
  ) dup;
  IF duplicate_count <> 0 THEN
    RAISE EXCEPTION 'Refusing duplicate candidate rows for % sections', duplicate_count;
  END IF;

  SELECT COUNT(*) INTO invalid_person_count
  FROM _m1c_responsible_candidates c
  LEFT JOIN atec.tblpeople p
    ON p.personid = c.assigned_responsibleid
  WHERE p.personid IS NULL
    OR COALESCE(p.archived, false) = true;
  IF invalid_person_count <> 0 THEN
    RAISE EXCEPTION 'Refusing % missing or archived candidate people', invalid_person_count;
  END IF;

  SELECT COUNT(*) INTO already_owned_count
  FROM _m1c_responsible_candidates c
  JOIN atec.tblsection sec
    ON sec.sectionid = c.sectionid
  WHERE sec.responsibleid IS NOT NULL;
  IF already_owned_count <> 0 THEN
    RAISE EXCEPTION 'Refusing to overwrite % already-owned sections', already_owned_count;
  END IF;

  SELECT COUNT(*) INTO cross_customer_count
  FROM _m1c_responsible_candidates c
  WHERE EXISTS (
    SELECT 1
    FROM atec.tblsection other_sec
    WHERE other_sec.responsibleid = c.assigned_responsibleid
      AND other_sec.clientid IS DISTINCT FROM c.clientid
      AND COALESCE(other_sec.archived, false) = false
  );
  IF cross_customer_count <> 0 THEN
    RAISE EXCEPTION 'Refusing % cross-customer candidate assignments', cross_customer_count;
  END IF;

  SELECT COUNT(*) INTO hierarchy_conflict_count
  FROM _m1c_responsible_candidates c
  JOIN atec.tblasset a
    ON a.sectionid = c.sectionid
  WHERE a.clientid IS DISTINCT FROM c.clientid
    OR a.siteid IS DISTINCT FROM c.siteid
    OR a.sectionid IS DISTINCT FROM c.sectionid;
  IF hierarchy_conflict_count <> 0 THEN
    RAISE EXCEPTION 'Refusing % hierarchy-conflicted candidate assets', hierarchy_conflict_count;
  END IF;
END $$;

INSERT INTO atec.responsible_person_ownership_repair_audit (
  migration_name,
  sectionid,
  previous_responsibleid,
  assigned_responsibleid,
  clientid,
  siteid,
  supporting_asset_count,
  governed_active_asset_count
)
SELECT
  '2026-07-16-assign-deterministic-missing-section-responsible-persons.sql',
  sectionid,
  previous_responsibleid,
  assigned_responsibleid,
  clientid,
  siteid,
  supporting_asset_count,
  governed_active_asset_count
FROM _m1c_responsible_candidates;

WITH updated AS (
  UPDATE atec.tblsection sec
  SET responsibleid = c.assigned_responsibleid
  FROM _m1c_responsible_candidates c
  WHERE sec.sectionid = c.sectionid
    AND sec.responsibleid IS NULL
  RETURNING sec.sectionid
)
SELECT COUNT(*) AS updated_section_count
FROM updated;

DO $$
DECLARE
  expected_section_count constant integer := 309;
  changed_count integer;
  postcondition_failures integer;
BEGIN
  SELECT COUNT(*) INTO changed_count
  FROM atec.responsible_person_ownership_repair_audit
  WHERE migration_name = '2026-07-16-assign-deterministic-missing-section-responsible-persons.sql';

  IF changed_count <> expected_section_count THEN
    RAISE EXCEPTION 'Audit row count mismatch after update: expected %, got %', expected_section_count, changed_count;
  END IF;

  SELECT COUNT(*) INTO postcondition_failures
  FROM atec.responsible_person_ownership_repair_audit audit
  JOIN atec.tblsection sec
    ON sec.sectionid = audit.sectionid
  LEFT JOIN atec.tblpeople p
    ON p.personid = audit.assigned_responsibleid
  WHERE audit.migration_name = '2026-07-16-assign-deterministic-missing-section-responsible-persons.sql'
    AND (
      sec.responsibleid IS DISTINCT FROM audit.assigned_responsibleid
      OR audit.previous_responsibleid IS NOT NULL
      OR p.personid IS NULL
      OR COALESCE(p.archived, false) = true
    );

  IF postcondition_failures <> 0 THEN
    RAISE EXCEPTION 'Postcondition failed for % repaired sections', postcondition_failures;
  END IF;
END $$;

COMMIT;
