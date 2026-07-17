-- Work Package 1: repair deterministic inspection signature snapshots.
--
-- Updates only tblinspection.inspector_signature_image where the inspection
-- has an inspector_user_id and that user's saved signature is present.
-- LMI values are not changed by this migration.

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

CREATE TABLE IF NOT EXISTS atec.inspection_signature_snapshot_repair_audit (
  migration_name text NOT NULL,
  testid bigint NOT NULL,
  inspector_user_id bigint NOT NULL,
  previous_inspector_signature_image text,
  assigned_inspector_signature_image text NOT NULL,
  previous_inspector_lmi_number text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text NOT NULL DEFAULT current_user,
  PRIMARY KEY (migration_name, testid)
);

CREATE TEMP TABLE _wp1_expected_signature_candidates (
  testid bigint PRIMARY KEY,
  inspector_user_id bigint NOT NULL
) ON COMMIT DROP;

INSERT INTO _wp1_expected_signature_candidates (testid, inspector_user_id)
VALUES
  (82846, 36),
  (82847, 36),
  (82862, 9),
  (83036, 9),
  (83037, 9),
  (83038, 9),
  (83039, 9),
  (83040, 9),
  (83092, 9);

CREATE TEMP TABLE _wp1_signature_candidates ON COMMIT DROP AS
SELECT
  i.testid,
  i.inspector_user_id,
  i.inspector_signature_image AS previous_inspector_signature_image,
  u.usersignature AS assigned_inspector_signature_image,
  i.inspector_lmi_number AS previous_inspector_lmi_number
FROM atec.tblinspection i
JOIN atec.tblusers u
  ON u.userid = i.inspector_user_id
JOIN _wp1_expected_signature_candidates expected
  ON expected.testid = i.testid
 AND expected.inspector_user_id = i.inspector_user_id
WHERE NULLIF(TRIM(COALESCE(i.inspector_signature_image, '')), '') IS NULL
  AND NULLIF(TRIM(COALESCE(u.usersignature, '')), '') IS NOT NULL;

DO $$
DECLARE
  expected_count constant integer := 9;
  candidate_count integer;
  missing_count integer;
  unexpected_count integer;
BEGIN
  SELECT COUNT(*) INTO candidate_count FROM _wp1_signature_candidates;
  IF candidate_count <> expected_count THEN
    RAISE EXCEPTION 'Signature candidate count changed: expected %, got %', expected_count, candidate_count;
  END IF;

  SELECT COUNT(*) INTO missing_count
  FROM _wp1_expected_signature_candidates expected
  LEFT JOIN _wp1_signature_candidates candidate
    ON candidate.testid = expected.testid
  WHERE candidate.testid IS NULL;
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'Refusing migration: % expected signature candidates are no longer valid', missing_count;
  END IF;

  SELECT COUNT(*) INTO unexpected_count
  FROM atec.tblinspection i
  JOIN atec.tblusers u
    ON u.userid = i.inspector_user_id
  LEFT JOIN _wp1_expected_signature_candidates expected
    ON expected.testid = i.testid
  WHERE NULLIF(TRIM(COALESCE(i.inspector_signature_image, '')), '') IS NULL
    AND NULLIF(TRIM(COALESCE(u.usersignature, '')), '') IS NOT NULL
    AND expected.testid IS NULL;
  IF unexpected_count <> 0 THEN
    RAISE EXCEPTION 'Refusing migration: % unreviewed signature candidates exist', unexpected_count;
  END IF;
END $$;

INSERT INTO atec.inspection_signature_snapshot_repair_audit (
  migration_name,
  testid,
  inspector_user_id,
  previous_inspector_signature_image,
  assigned_inspector_signature_image,
  previous_inspector_lmi_number
)
SELECT
  '2026-07-16-repair-deterministic-inspection-signature-snapshots.sql',
  testid,
  inspector_user_id,
  previous_inspector_signature_image,
  assigned_inspector_signature_image,
  previous_inspector_lmi_number
FROM _wp1_signature_candidates;

WITH updated AS (
  UPDATE atec.tblinspection i
  SET inspector_signature_image = candidate.assigned_inspector_signature_image
  FROM _wp1_signature_candidates candidate
  WHERE i.testid = candidate.testid
    AND i.inspector_user_id IS NOT DISTINCT FROM candidate.inspector_user_id
    AND i.inspector_signature_image IS NOT DISTINCT FROM candidate.previous_inspector_signature_image
    AND i.inspector_lmi_number IS NOT DISTINCT FROM candidate.previous_inspector_lmi_number
  RETURNING i.testid
)
SELECT COUNT(*) AS updated_inspection_count
FROM updated;

DO $$
DECLARE
  expected_count constant integer := 9;
  audit_count integer;
  postcondition_failures integer;
  lmi_changes integer;
BEGIN
  SELECT COUNT(*) INTO audit_count
  FROM atec.inspection_signature_snapshot_repair_audit
  WHERE migration_name = '2026-07-16-repair-deterministic-inspection-signature-snapshots.sql';

  IF audit_count <> expected_count THEN
    RAISE EXCEPTION 'Audit count mismatch: expected %, got %', expected_count, audit_count;
  END IF;

  SELECT COUNT(*) INTO postcondition_failures
  FROM atec.inspection_signature_snapshot_repair_audit audit
  JOIN atec.tblinspection i
    ON i.testid = audit.testid
  WHERE audit.migration_name = '2026-07-16-repair-deterministic-inspection-signature-snapshots.sql'
    AND i.inspector_signature_image IS DISTINCT FROM audit.assigned_inspector_signature_image;
  IF postcondition_failures <> 0 THEN
    RAISE EXCEPTION 'Postcondition failed: % signature snapshots were not assigned', postcondition_failures;
  END IF;

  SELECT COUNT(*) INTO lmi_changes
  FROM atec.inspection_signature_snapshot_repair_audit audit
  JOIN atec.tblinspection i
    ON i.testid = audit.testid
  WHERE audit.migration_name = '2026-07-16-repair-deterministic-inspection-signature-snapshots.sql'
    AND i.inspector_lmi_number IS DISTINCT FROM audit.previous_inspector_lmi_number;
  IF lmi_changes <> 0 THEN
    RAISE EXCEPTION 'Postcondition failed: % LMI snapshots changed', lmi_changes;
  END IF;
END $$;

COMMIT;
